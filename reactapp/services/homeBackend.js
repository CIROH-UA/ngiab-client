// reactapp/services/homeBackend.js
import Backend from "./Backend";

// Connect to the "ngiab" consumer (tethysapp/ngiab/consumers/home.py)
const homeBackend = new Backend("/");
export default homeBackend;
