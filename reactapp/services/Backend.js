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
      this.wsUrl = `${protocol}://${hostname}:${port}${window.location.pathname}ws/`;
    } else {
      this.wsUrl = `${protocol}://${hostname}${window.location.pathname}ws/`;
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
      RUN_PREPROCESS: "RUN_PREPROCESS",
      RUN_CALIBRATION: "RUN_CALIBRATION",
      RUN_NGIAB: "RUN_NGIAB",
      RUN_TEERH: "RUN_TEERH",
      RUN_WORKFLOW: "RUN_WORKFLOW",
      REQUEST_LAST_RUN: "REQUEST_LAST_RUN",
      RUN_NODE: "RUN_NODE"
    };
  }

  // --- Mini emitter (stable arrow keeps lexical `this`) ---
  _emit = (type, payload = {}) => {
    const h = this.messageHandlers[type];
    if (typeof h === "function") {
      try {
        h(payload);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // --- Stable event handlers (added/removed by reference) ---
  _handleOpen = () => {
    // Reset backoff and notify listeners
    this.reconnectInterval = 5000;
    this._emit("WS_CONNECTED");

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
    this.onConnectCallback?.();
  };

  _handleClose = (ev) => {
    this._emit("WS_DISCONNECTED", { code: ev.code, reason: ev.reason });
    this.reconnect();
  };

  _handleError = () => {
    this._emit("WS_DISCONNECTED", { error: true });
    this.reconnect();
  };

  _handleMessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("Received message: ", data);
    if (!("action" in data) || !("type" in data.action) || !("payload" in data)) {
      console.error(`Error: malformed message received: ${JSON.stringify(data)}`);
      return;
    }
    if (!(data.action.type in this.messageHandlers)) {
      console.warn(`Warning: no handler found for message of type "${data.action.type}".`);
      return;
    }
    this.messageHandlers[data.action.type](data.payload);
  };

  connect(onConnectCallback) {
    this.onConnectCallback = onConnectCallback;

    // Detach old listeners if reconnecting
    if (this.webSocket) {
      this.webSocket.removeEventListener("open", this._handleOpen);
      this.webSocket.removeEventListener("close", this._handleClose);
      this.webSocket.removeEventListener("error", this._handleError);
      this.webSocket.removeEventListener("message", this._handleMessage);
    }

    // New socket + listeners
    this.webSocket = new WebSocket(this.wsUrl);
    this.webSocket.addEventListener("open", this._handleOpen);
    this.webSocket.addEventListener("close", this._handleClose);
    this.webSocket.addEventListener("error", this._handleError);
    this.webSocket.addEventListener("message", this._handleMessage);
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
      });
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
    const actionMessage = {
      action: {
        id: actionId,
        type: action,
      },
      payload: data,
    };

    // Only send when OPEN; otherwise this will throw. (1 === WebSocket.OPEN)
    // https://developer.mozilla.org/docs/Web/API/WebSocket/readyState
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not open; cannot send action:", action);
      return actionId;
    }

    this.webSocket.send(this.serialize(actionMessage));
    return actionId;
  }

  serialize(obj) {
    return JSON.stringify(obj, this._jsonSerializer);
  }

  _jsonSerializer(key, value) {
    // Serialize name of file and send file separately
    if (typeof File !== "undefined" && value instanceof File) {
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
