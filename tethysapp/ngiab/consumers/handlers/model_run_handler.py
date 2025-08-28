# tethysapp/ngiab/consumers/handlers/model_run_handler.py
from __future__ import annotations

import logging
from typing import Any, Optional, Callable, Awaitable, Dict

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
try:
    # SQLAlchemy 2.0+
    from sqlalchemy.ext.asyncio import async_sessionmaker  # type: ignore
except Exception:  # pragma: no cover
    async_sessionmaker = None  # type: ignore[assignment]
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async

from tethysapp.ngiab.app import App
from ..backend_actions import BackendActions

log = logging.getLogger(__name__)


class ModelBackendHandler:
    """
    Base handler for Channels consumers that need DB access.

    - Uses Tethys persistent store config to build an **async** SQLAlchemy URL.
    - Wraps the sync Django/Tethys call with `database_sync_to_async` so we don't
      hit Django's SynchronousOnlyOperation inside async code.
    """

    def __init__(self, backend_consumer: Any) -> None:
        self.backend_consumer = backend_consumer
        self._engine = None
        self._Session = None  # async sessionmaker

    async def send_action(self, action: BackendActions | str, payload: Dict[str, Any]) -> None:
        await self.backend_consumer.send_action(action, payload)

    async def send_acknowledge(self, msg: str, action: dict, payload: dict,
                               details: Optional[dict] = None) -> None:
        await self.backend_consumer.send_acknowledge(msg, action, payload, details)

    async def send_error(self, msg: str, action: dict, payload: dict,
                         details: Optional[dict] = None) -> None:
        await self.backend_consumer.send_error(msg, action, payload, details)

    # -------------------------------------------------------------------------
    # Async sessionmaker bootstrap (wrap Django/Tethys ORM calls correctly)
    # -------------------------------------------------------------------------
    async def get_sessionmaker(self):
        """
        Lazily build and cache an async sessionmaker.

        Calls App.get_persistent_store_database(...) via database_sync_to_async
        to avoid SynchronousOnlyOperation in async context. See:
         - Channels docs on DB access from AsyncConsumer
         - Django async docs (sync_to_async)
        """
        if self._Session:
            return self._Session

        # This hits Django ORM under the hood -> wrap with database_sync_to_async
        sync_url = await database_sync_to_async(App.get_persistent_store_database)(
            "workflows", as_url=True
        )
        async_url = sync_url.set(drivername="postgresql+asyncpg")
        db_url = str(async_url)

        self._engine = create_async_engine(db_url, echo=False, future=True)
        if async_sessionmaker:
            self._Session = async_sessionmaker(self._engine, expire_on_commit=False, class_=AsyncSession)
        else:
            # Fallback for older SQLAlchemy: still returns an async session class
            self._Session = sessionmaker(bind=self._engine, class_=AsyncSession, expire_on_commit=False)

        return self._Session

    # -------------------------------------------------------------------------
    # Decorator: wrap action handlers with async session + robust error handling
    # -------------------------------------------------------------------------
    @staticmethod
    def action_handler(method: Callable[..., Awaitable[None]]):
        async def _action_handler(self: "ModelBackendHandler", event, action, data):
            try:
                Session = await self.get_sessionmaker()
                async with Session() as session:
                    try:
                        await method(self, event, action, data, session)
                    except SQLAlchemyError as e:
                        msg = f"Database error: {e.__class__.__name__}"
                        await self.send_error(msg, action, data, {"detail": str(e)})
                        log.exception(msg)
                    except ValueError as e:
                        msg = str(e)
                        await self.send_error(msg, action, data)
                        log.debug(msg)
                    except Exception:
                        msg = f'Unexpected error while handling "{action.get("type")}"'
                        await self.send_error(msg, action, data)
                        log.exception(msg)
            except Exception:
                # If we failed even before opening a session (e.g., config access),
                # surface a top-level error.
                msg = "Failed to initialize database session"
                await self.send_error(msg, action, data)
                log.exception(msg)

        return _action_handler
