import { getTethysPortalHost, newUUID } from "./utilities";
import { toast } from "react-toastify";

export default class Backend {
  constructor(rootUrl) {
    const tethys_portal_host = getTethysPortalHost();
    const hostname = tethys_portal_host.hostname;
    // const port = tethys_portal_host.port;
    const port = 8000;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'; // Determine protocol based on current page's protocol

    if (port) {
      this.wsUrl = `${protocol}://${hostname}:${port}${window.location.pathname}ngiab-run/ws/`;
    } else {
      this.wsUrl = `${protocol}://${hostname}${window.location.pathname}ngiab-run/ws/`;
    }

    this.rootUrl = rootUrl;
    this.webSocket = null;
    this.messageHandlers = {};
    this.pendingActions = {};
    this.reconnectToastId = "toast-reconnect";
    this.couldNotReconnectToastId = "toast-disconnect";
    this.connect = this.connect.bind(this);
    this.reconnect = this.reconnect.bind(this);
    this.reconnectInterval = 5000; // Time interval to attempt reconnection (5 seconds)
    this.isReconnecting = false;
    this.onConnectCallback = null;
  }

  get actions() {
    return {
        RUN_NGIAB: "RUN_NGIAB",
        RUN_TEERH: "RUN_TEERH",
    };
  }

  connect(onConnectCallback) {
    this.onConnectCallback = onConnectCallback
    if (this.webSocket) {
      this.webSocket.removeEventListener("close", this.reconnect);
      this.webSocket.removeEventListener("error", this.reconnect);
    }

    this.webSocket = new WebSocket(this.wsUrl);
    this.webSocket.addEventListener("close", this.reconnect);
    this.webSocket.addEventListener("error", this.reconnect);

    this.webSocket.addEventListener("open", () => {
      if (this.isReconnecting) {
        toast.dismiss(this.reconnectToastId);
        toast.success("Successfully reconnected to the backend!", {
          position: "top-right",
          autoClose: 3000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
        });
      }
      this.isReconnecting = false;
      onConnectCallback();
    });
    /***************************************************************************/
    /* On message received, parse the message and call the appropriate handler */
    /***************************************************************************/
    this.webSocket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      console.log("Received message: ", data);
      if (!("action" in data) || !("type" in data.action) || !("payload" in data)) {
        console.error(
          `Error: malformed message received: ${JSON.stringify(data)}`
        );
        return;
      }

      if (data.action.type in this.messageHandlers) {
        this.messageHandlers[data.action.type](data.payload);
      } else {
        console.warn(
          `Warning: no handler found for message of type "${data.action.type}".`
        );
      }
    });

  }

  reconnect() {
    if (this.reconnectInterval >= 320000) {
      toast.dismiss(this.reconnectToastId);
      toast.error("Could not reconnect to the backend in time. Refresh the page to try again.", {
        position: "top-right",
        autoClose: false,
        hideProgressBar: true,
        closeOnClick: false,
        pauseOnHover: false,
        pauseOnFocusLoss: false,
        draggable: false,
        progress: undefined,
        toastId: this.couldNotReconnectToastId,
      })
      return;
    }
    if (!toast.isActive(this.reconnectToastId)) {
      toast.warning(`WebSocket connection lost, attempting to reconnect...`, {
        position: "top-right",
        autoClose: false,
        hideProgressBar: true,
        closeOnClick: false,
        pauseOnHover: false,
        pauseOnFocusLoss: false,
        draggable: false,
        progress: undefined,
        toastId: this.reconnectToastId,
      });
    }
    this.isReconnecting = true;
    setTimeout(() => {
      this.connect(this.onConnectCallback);
    }, this.reconnectInterval);
    this.reconnectInterval *= 2;
  }

  on(type, func) {
    this.messageHandlers[type] = func;
  }
  off(type) {
    delete this.messageHandlers[type];
  }
  do(action, data) {
    const actionId = newUUID();
    let actionMessage = {
      action: {
        id: actionId,
        type: action,
      },
      payload: data
    };
    // console.log("Sending message: ", actionMessage);
    this.webSocket.send(this.serialize(actionMessage));
    return actionId;
  }

  serialize(obj) {
    return JSON.stringify(obj, this._jsonSerializer);
  }

  _jsonSerializer(key, value) {
    // Serialize name of file and send file separately
    if (value instanceof File) {
      return value.name;
    }
    // Don't serialize private members (i.e. start with "_")
    if (key.startsWith("_")) {
      return; // skip
    }
    // Everything else default serialization
    return value;
  }
}