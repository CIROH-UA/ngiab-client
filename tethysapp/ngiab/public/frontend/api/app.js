import { getJSON } from './client.js';
import { getConfig } from '../config.js';

// Endpoints are built at call time rather than module load, because getConfig() reads
// window.__NGIAB__ and tests reassign it between cases.
const url = (name) => `${getConfig().APP_ROOT_URL}${name}/`;

// Viewer endpoints only.
//
// Deliberately absent, and not oversights:
//   - getNexusTimeSeries  -- nexus was dropped from the product entirely.
//   - getModelRuns / importModelRuns -- run selection is deferred; the run comes from
//     ?model_run_id= for now.
//   - every datastream_* endpoint -- DataStream was removed.
// See the scope decisions in the design spec.
const appAPI = {
  getGeoSpatialData: (params) => getJSON(url('getGeoSpatialData'), params),

  getCatchmentTimeSeries: (params) => getJSON(url('getCatchmentTimeSeries'), params),

  getTrouteVariables: (params) => getJSON(url('getTrouteVariables'), params),
  getTrouteTimeSeries: (params) => getJSON(url('getTrouteTimeSeries'), params),

  getTeehrLocations: (params) => getJSON(url('getTeehrLocations'), params),
  getTeehrVariables: (params) => getJSON(url('getTeehrVariables'), params),
  getTeehrTimeSeries: (params) => getJSON(url('getTeehrTimeSeries'), params),
};

export default appAPI;
