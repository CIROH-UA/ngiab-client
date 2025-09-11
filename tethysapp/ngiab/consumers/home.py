# tethysapp/ngiab/consumers/home.py
import datetime
import json
import logging
import uuid
from channels.consumer import AsyncConsumer
from tethys_sdk.routing import consumer
from tethysapp.ngiab.app import App
from .handlers import HomeImportHandler  # new handler

log = logging.getLogger(__name__)

@consumer(name="ngiab", url="ngiab")
class ModelsConsumer(AsyncConsumer):
    """
    Home/NGIAB consumer for lightweight actions (e.g., import-from-S3).
    """
    channel_layer_alias = App.package

    async def websocket_connect(self, event):
        self.handlers = (HomeImportHandler(self),)
        self.group_name = "ngiab"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.send({"type": "websocket.accept"})
        log.debug("Home WebSocket connected")

    async def websocket_disconnect(self, close_code):
        try:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        finally:
            log.debug("Home WebSocket disconnected")

    async def websocket_receive(self, event):
        if "text" not in event:
            return
        try:
            data = json.loads(event.get("text"))
            message_action = data.get("action", {}) or {}
            message_type = str(message_action.get("type") or "").upper()
            message_data = data.get("payload")

            if not message_type or message_data is None:
                msg = f"Malformed message received: {event.get('text', 'no text')}"
                log.error(msg)
                await self.send_error(msg, message_action, message_data)
                return

            dispatched = False
            for handler in self.handlers:
                ra = {str(k).upper(): v for k, v in (getattr(handler, "receiving_actions", {}) or {}).items()}
                if message_type in ra:
                    await ra[message_type](event=event, action=message_action, data=message_data)
                    dispatched = True
                    break

            if not dispatched:
                msg = f'Unhandled message type received: "{message_type}"'
                log.warning(msg)
                await self.send_error(msg, message_action, message_data)

        except Exception:
            log.exception("Unexpected error while handling message in home consumer.")

    # ---- utilities (same shape as your workflows consumer)
    async def send_action(self, action: str, payload):
        message = {
            "type": "websocket.send",
            "text": json.dumps(
                {"action": {"id": str(uuid.uuid4()), "type": str(action)}, "payload": payload},
                default=self._json_serializer,
            ),
        }
        await self.send(message)

    async def send_acknowledge(self, msg: str, action: dict, payload: dict, details: dict | None = None):
        await self.send_action("MESSAGE_ACKNOWLEDGE", {"message": msg, "received": {"action": action, "payload": payload}, "details": details})

    async def send_error(self, msg: str, action: dict, payload: dict, details: dict | None = None):
        await self.send_action("MESSAGE_ERROR", {"message": msg, "received": {"action": action, "payload": payload}, "details": details})

    @staticmethod
    def _json_serializer(obj):
        if isinstance(obj, uuid.UUID):
            return str(obj)
        elif isinstance(obj, (datetime.datetime, datetime.date)):
            return obj.isoformat()
