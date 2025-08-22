import datetime
import json
import logging
import queue
import uuid

from channels.consumer import AsyncConsumer
from tethys_sdk.routing import consumer

from .backend_actions import BackendActions
from .handlers import (
    NgiabBackendHandler
)
from tethysapp.ngiab.app import App

log = logging.getLogger(__name__)


@consumer(name="workflows", url="workflows")
class BackendConsumer(AsyncConsumer):
    channel_layer_alias = App.package

    file_q = queue.Queue()

    async def websocket_connect(self, event):
        print("-----------WebSocket Connected-----------")

        self.handlers = (
            NgiabBackendHandler(self),
        )
        # Join channel group
        self.group_name = "workflows"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        
        # Accept the connection
        await self.send({
            "type": "websocket.accept",
        })
        log.debug("-----------WebSocket Connected-----------")

    async def websocket_disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)
        log.debug("-----------WebSocket Disconnected-----------")

    async def websocket_receive(self, event):
        try:
            if "text" in event:
                data = json.loads(event.get("text"))
                message_action = data.get("action", {})
                message_type = message_action.get("type")
                message_data = data.get("payload")
                
                if not message_action or not message_type or not message_data:
                    msg = f"Malformed message received: {event.get('text', 'no text in message')}"
                    log.error(msg)
                    await self.send_error(msg, message_action, message_data)
                    return

                # Look up the handler for the message type and call the appropriate method
                handler_found = False
                # breakpoint()
                for handler in self.handlers:
                    if message_type in handler.receiving_actions:
                        handler_found = True
                        await handler.receiving_actions[message_type](
                            event=event,
                            action=message_action,
                            data=message_data,
                        )
                        break

                if not handler_found:
                    msg = f'Unhandled message type received: "{message_type}"'
                    log.warning(msg)
                    await self.send_error(msg, message_action, message_data)

        except Exception:
            event_summary = (event if "bytes" not in event else f"BYTES: {len(event['bytes'])}")
            log.exception(f"An unexpected error occurred: {event_summary}")

    async def send_action(self, action: BackendActions, payload):
        message = {
            "type":
                "websocket.send",
            "text":
                json.dumps(
                    {
                        "action": {
                            "id": str(uuid.uuid4()),
                            "type": str(action),
                        },
                        "payload": payload
                    },
                    default=self._json_serializer
                ),
        }
        await self.send(message)

    async def send_acknowledge(self, msg: str, action: BackendActions, payload: dict, details: dict = None):
        """Send an acknowledge message to the frontend.

        Args:
            msg: The acknowledge message.
            action: The received action during which the error occurred.
            payload: The payload received with the received action.
            details: Additional details about the acknowledge message.
        """
        ack_dict = {
            'message': msg,
            'received': {
                'action': action,
                'payload': payload,
            },
            'details': details,
        }
        await self.send_action(BackendActions.MESSAGE_ACKNOWLEDGE, ack_dict)

    async def send_error(self, msg: str, action: dict, payload: dict, details: dict = None):
        """Send an error message to the frontend.

        Args:
            msg: The error message.
            action: The received action during which the error occurred.
            payload: The payload received with the received action.
            details: Additional details about the error message.
        """
        err_dict = {
            'message': msg,
            'received': {
                'action': action,
                'payload': payload,
            },
            'details': details,
        }
        await self.send_action(BackendActions.MESSAGE_ERROR, err_dict)

    @staticmethod
    def _json_serializer(obj):
        if isinstance(obj, uuid.UUID):
            return str(obj)
        elif isinstance(obj, (datetime.datetime, datetime.date)):
            return obj.isoformat()