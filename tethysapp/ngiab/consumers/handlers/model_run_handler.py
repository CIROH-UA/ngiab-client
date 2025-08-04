from __future__ import annotations

import logging
from typing import (
    List,
    Optional,
    Union,
    Dict,
    Any
)

from ..backend_actions import BackendActions


log = logging.getLogger(__name__)

class ModelBackendHandler:

    SEND_DATA_ACTION: Optional[BackendActions] = None
    PROP_DNE = '###prop-doesnt-exist###'  # For getattr checks where None value is valid

    def __init__(self, backend_consumer: Any) -> None:
        self.backend_consumer = backend_consumer

    @property
    def receiving_actions(self) -> dict[BackendActions, callable]:
        raise NotImplementedError("The receiving_actions property must be implemented by the subclass.")


    async def send_data(
        self,
        model: Any,
        from_action: str
    ) -> None:
        """
        Convert one or many CUAHSISite objects to a Pydantic model and send them.
        """
        if not self.SEND_DATA_ACTION:
            log.error(f'No SEND_DATA_ACTION defined for "{self.__class__.__name__}".')
            raise NotImplementedError("SEND_DATA_ACTION must be defined in the subclass.")

        data_out = model
        payload: dict[str, Any] = {
            "fromAction": from_action,
            "data": data_out
        }
        await self.send_action(self.SEND_DATA_ACTION, payload)

    async def send_action(self, action: BackendActions, payload: dict[str, Any]) -> None:
        """Send an action + payload to the frontend via the consumer."""
        await self.backend_consumer.send_action(action, payload)

    async def send_acknowledge(
        self,
        msg: str,
        action: BackendActions,
        payload: dict[str, Any],
        details: Optional[dict[str, Any]] = None
    ) -> None:
        """Sends an acknowledgement."""
        await self.backend_consumer.send_acknowledge(msg, action, payload, details)

    async def send_error(
        self,
        msg: str,
        action: dict[str, Any],
        payload: dict[str, Any],
        details: Optional[dict[str, Any]] = None
    ) -> None:
        """Sends an error message."""
        await self.backend_consumer.send_error(msg, action, payload, details)



