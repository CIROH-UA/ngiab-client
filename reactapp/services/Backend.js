// reactapp/services/Backend.js
import { getTethysPortalHost, newUUID } from "./utilities";
import { toast } from "react-toastify";

export default class Backend {
  constructor(rootUrl) {
  // constructor(rootUrl) {
    const tethys_portal_host = getTethysPortalHost();
    const hostname = tethys_portal_host.hostname;
    // If you want to use the portal's port, replace with: const port = tethys_portal_host.port;
    const port = 8000;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";

    if (port) {
      this.wsUrl = `${protocol}://${hostname}:${port}${window.location.pathname}ws/`;
    } else {
      this.wsUrl = `${protocol}://${hostname}${window.location.pathname}ws/`;
    }


    // Derive the app root like: /apps/<slug>/
    // const match = window.location.pathname.match(/^(.*?\/apps\/[^/]+\/)/);
    // const appRoot = match ? match[1] : "/";
    // const consumer = String(consumerPath).replace(/^\/|\/$/g, "");
    // const hostWithPort = port ? `${hostname}:${port}` : hostname;
    // this.wsUrl = `${protocol}://${hostWithPort}${appRoot}${consumer}/ws/`;

    this.rootUrl = rootUrl;
    this.webSocket = null;

    // Map of ACTION_TYPE -> handler(payload)
    this.messageHandlers = {};
    this.pendingActions = {};

    this.reconnectToastId = "toast-reconnect";
    this.couldNotReconnectToastId = "toast-disconnect";

    this.connect = this.connect.bind(this);
    this.reconnect = this.reconnect.bind(this);

    this.reconnectInterval = 5000; // 5s backoff start; doubles up to cap
    this.isReconnecting = false;
    this.onConnectCallback = null;

    // arrow fn ensures proper `this`
    this._emit = (type, payload = {}) => {
      const key = String(type).toUpperCase();
      const h = this.messageHandlers[key];
      if (typeof h === "function") {
        try {
          h(payload);
        } catch (e) {
          console.error(e);
        }
      }
    };
  }

  get actions() {
    return {
      RUN_NGIAB: "RUN_NGIAB",
      RUN_TEERH: "RUN_TEERH",
      RUN_WORKFLOW: "RUN_WORKFLOW",
      RUN_NODE: "RUN_NODE",
      REQUEST_LAST_RUN: "REQUEST_LAST_RUN",
      // server → client pushes you listen for
      NODE_STATUS: "NODE_STATUS",
      WORKFLOW_SUBMITTED: "WORKFLOW_SUBMITTED",
      LAST_RUN_LOG: "LAST_RUN_LOG",
      WS_CONNECTED: "WS_CONNECTED",
      WS_DISCONNECTED: "WS_DISCONNECTED",
      MESSAGE_ERROR: "MESSAGE_ERROR",
      MESSAGE_ACKNOWLEDGE: "MESSAGE_ACKNOWLEDGE",
    };
  }

  connect(onConnectCallback) {
    this.onConnectCallback = onConnectCallback;

    // Clean up previous listeners if reconnecting
    if (this.webSocket) {
      try {
        this.webSocket.close();
      } catch {
        // ignore
      }
    }

    this.webSocket = new WebSocket(this.wsUrl);

    // ---- lifecycle
    this.webSocket.addEventListener("open", () => {
      // reset backoff after success
      this.reconnectInterval = 5000;

      // notify UI
      this._emit("WS_CONNECTED", {});

      if (this.isReconnecting) {
        toast.dismiss(this.reconnectToastId);
        toast.success("Successfully reconnected to the backend!", {
          position: "top-right",
          autoClose: 3000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
        });
      }
      this.isReconnecting = false;

      if (typeof this.onConnectCallback === "function") {
        try {
          this.onConnectCallback();
        } catch (e) {
          console.error("onConnectCallback error:", e);
        }
      }
    });

    this.webSocket.addEventListener("close", (ev) => {
      this._emit("WS_DISCONNECTED", { code: ev.code, reason: ev.reason });
      this.reconnect();
    });

    this.webSocket.addEventListener("error", () => {
      this._emit("WS_DISCONNECTED", { error: true });
      this.reconnect();
    });

    // ---- messages
    this.webSocket.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        console.error("Malformed WS payload:", event.data);
        return;
      }

      if (!data?.action?.type || !("payload" in data)) {
        console.error("Malformed WS message:", data);
        return;
      }

      // Normalize the action type to uppercase for handler lookup
      const type = String(data.action.type).toUpperCase();
      const payload = data.payload;

      if (!(type in this.messageHandlers)) {
        // Helpful for debugging mismatched action names
        console.warn(`No handler for message type "${data.action.type}"`, { payload });
        return;
      }

      try {
        this.messageHandlers[type](payload);
      } catch (err) {
        console.error(`Handler error for "${type}":`, err);
      }
    });
  }

  reconnect() {
    // cap at ~5m 20s
    if (this.reconnectInterval >= 320000) {
      toast.dismiss(this.reconnectToastId);
      toast.error(
        "Could not reconnect to the backend in time. Refresh the page to try again.",
        {
          position: "top-right",
          autoClose: false,
          hideProgressBar: true,
          closeOnClick: false,
          pauseOnHover: false,
          pauseOnFocusLoss: false,
          draggable: false,
          toastId: this.couldNotReconnectToastId,
        }
      );
      return;
    }
    if (!toast.isActive(this.reconnectToastId)) {
      toast.warning("WebSocket connection lost, attempting to reconnect...", {
        position: "top-right",
        autoClose: false,
        hideProgressBar: true,
        closeOnClick: false,
        pauseOnHover: false,
        pauseOnFocusLoss: false,
        draggable: false,
        toastId: this.reconnectToastId,
      });
    }
    this.isReconnecting = true;

    setTimeout(() => {
      this.connect(this.onConnectCallback);
    }, this.reconnectInterval);

    this.reconnectInterval *= 2;
  }

  // ---- public API for registering/unregistering handlers
  on(type, func) {
    const key = String(type).toUpperCase();
    this.messageHandlers[key] = func;
  }

  off(type) {
    const key = String(type).toUpperCase();
    delete this.messageHandlers[key];
  }

  // ---- send an action to backend
  do(action, data) {
    if (!this.webSocket || this.webSocket.readyState !== 1) {
      throw new Error("WebSocket is not connected");
    }
    const actionId = newUUID();
    const msg = {
      action: {
        id: actionId,
        type: typeof action === "string" ? action : String(action),
      },
      payload: data,
    };
    this.webSocket.send(this.serialize(msg));
    return actionId;
  }

  serialize(obj) {
    return JSON.stringify(obj, this._jsonSerializer);
  }

  _jsonSerializer(key, value) {
    // Serialize name of File; send file out-of-band in your app if needed
    if (typeof File !== "undefined" && value instanceof File) {
      return value.name;
    }
    // Skip private members
    if (key && typeof key === "string" && key.startsWith("_")) {
      return undefined;
    }
    return value;
  }
}
