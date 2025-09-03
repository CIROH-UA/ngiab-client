
import logging
from channels.consumer import AsyncConsumer
from tethys_sdk.routing import consumer


from tethysapp.ngiab.app import App

log = logging.getLogger(__name__)

@consumer(name="datastream", url="datastream")
class DataStreamConsumer(AsyncConsumer):
    async def websocket_connect(self, event):
        await self.send({"type": "websocket.accept"})
        log.debug("WebSocket connected")

    async def websocket_disconnect(self, close_code):
        log.debug("WebSocket disconnected")

    async def websocket_receive(self, event):
        if "text" in event:
            text_data = event["text"]
            log.debug(f"Received WebSocket message: {text_data}")
            await self.send({"type": "websocket.send", "text": text_data})
        else:
            log.warning("Received non-text WebSocket message; ignoring.")