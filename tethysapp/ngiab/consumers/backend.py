import datetime
import json
import logging
import queue
import uuid

from channels.consumer import AsyncConsumer
from tethys_sdk.routing import consumer

from .backend_actions import BackendActions
from .handlers import NgiabBackendHandler
from tethysapp.ngiab.app import App

log = logging.getLogger(__name__)


@consumer(name="workflows", url="workflows")
class BackendConsumer(AsyncConsumer):
    """
    Channels AsyncConsumer that multiplexes actions to registered handlers.

    Sends websocket frames per Channels docs via:
        await self.send({"type": "websocket.accept"})
        await self.send({"type": "websocket.send", "text": json_str})
    """
    channel_layer_alias = App.package
    file_q = queue.Queue()

    async def websocket_connect(self, event):
        self.handlers = (NgiabBackendHandler(self),)

        # Join a broadcast group (optional; useful for server->all pushes)
        self.group_name = "workflows"
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        # Accept connection
        await self.send({"type": "websocket.accept"})
        log.debug("WebSocket connected")

    async def websocket_disconnect(self, close_code):
        try:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        finally:
            log.debug("WebSocket disconnected")

    async def websocket_receive(self, event):
        """
        Expect messages of shape:
        {
          "action": {"id": "<uuid>", "type": "<string>"},
          "payload": {...}
        }
        """
        try:
            if "text" not in event:
                return

            data = json.loads(event.get("text"))
            message_action = data.get("action", {}) or {}
            message_type = message_action.get("type")
            message_data = data.get("payload")

            if not message_type or message_data is None:
                msg = f"Malformed message received: {event.get('text', 'no text')}"
                log.error(msg)
                await self.send_error(msg, message_action, message_data)
                return

            # Route to a handler
            for handler in self.handlers:
                if message_type in handler.receiving_actions:
                    await handler.receiving_actions[message_type](
                        event=event,
                        action=message_action,
                        data=message_data,
                    )
                    break
            else:
                msg = f'Unhandled message type received: "{message_type}"'
                log.warning(msg)
                await self.send_error(msg, message_action, message_data)

        except Exception:
            event_summary = event if "bytes" not in event else f"BYTES: {len(event['bytes'])}"
            log.exception(f"Unexpected error while handling message: {event_summary}")

    # ---- Utilities for handlers ------------------------------------------------

    async def send_action(self, action: BackendActions | str, payload):
        """Send an action to the frontend as a JSON text frame."""
        message = {
            "type": "websocket.send",
            "text": json.dumps(
                {
                    "action": {"id": str(uuid.uuid4()), "type": str(action)},
                    "payload": payload,
                },
                default=self._json_serializer,
            ),
        }
        await self.send(message)

    async def send_acknowledge(self, msg: str, action: dict, payload: dict, details: dict | None = None):
        ack_dict = {
            "message": msg,
            "received": {"action": action, "payload": payload},
            "details": details,
        }
        await self.send_action(BackendActions.MESSAGE_ACKNOWLEDGE, ack_dict)

    async def send_error(self, msg: str, action: dict, payload: dict, details: dict | None = None):
        err_dict = {
            "message": msg,
            "received": {"action": action, "payload": payload},
            "details": details,
        }
        await self.send_action(BackendActions.MESSAGE_ERROR, err_dict)

    @staticmethod
    def _json_serializer(obj):
        if isinstance(obj, uuid.UUID):
            return str(obj)
        elif isinstance(obj, (datetime.datetime, datetime.date)):
            return obj.isoformat()
