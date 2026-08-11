import { getJSON } from './client.js';
import { getConfig } from '../config.js';

// Built at call time: getConfig() reads window.__NGIAB__, which tests reassign.
const url = (name) => `${getConfig().APP_ROOT_URL}${name}/`;

// Viewer endpoints only.
const appAPI = {
  getModelRuns: () => getJSON(url('getModelRuns')),
  removeModelRun: (params) => getJSON(url('removeModelRun'), params),

  getGeoSpatialData: (params) => getJSON(url('getGeoSpatialData'), params),

  getCatchmentTimeSeries: (params) => getJSON(url('getCatchmentTimeSeries'), params),

  getTrouteVariables: (params) => getJSON(url('getTrouteVariables'), params),
  getTrouteTimeSeries: (params) => getJSON(url('getTrouteTimeSeries'), params),

  getTeehrLocations: (params) => getJSON(url('getTeehrLocations'), params),
  getTeehrVariables: (params) => getJSON(url('getTeehrVariables'), params),
  getTeehrTimeSeries: (params) => getJSON(url('getTeehrTimeSeries'), params),
};

export default appAPI;
