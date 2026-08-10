import { getJSON } from './client.js';
import { getConfig } from '../config.js';

// Endpoints are built at call time rather than module load, because getConfig() reads
// window.__NGIAB__ and tests reassign it between cases.
const url = (name) => `${getConfig().APP_ROOT_URL}${name}/`;

// Viewer endpoints only.
//
// Deliberately absent, and not oversights:
//   - getNexusTimeSeries  -- nexus was dropped from the product entirely.
//   - importModelRuns -- the S3 import flow belongs to DataStream, which was removed.
//   - every datastream_* endpoint -- DataStream was removed.
// See the scope decisions in the design spec.
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
