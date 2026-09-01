import { getJSON, postJSON } from './client.js';
import { getConfig } from '../config.js';

const url = (name) => `${getConfig().APP_ROOT_URL}${name}/`;

const appAPI = {
  getModelRuns: () => getJSON(url('getModelRuns')),

  removeModelRun: (params) => postJSON(url('removeModelRun'), params),

  getGeoSpatialData: (params) => getJSON(url('getGeoSpatialData'), params),

  getCatchmentTimeSeries: (params) => getJSON(url('getCatchmentTimeSeries'), params),
  getCatchmentVariables: (params) => getJSON(url('getCatchmentVariables'), params),
  getCatchmentValueMatrix: (params) => getJSON(url('getCatchmentValueMatrix'), params),

  getTrouteVariables: (params) => getJSON(url('getTrouteVariables'), params),
  getTrouteTimeSeries: (params) => getJSON(url('getTrouteTimeSeries'), params),

  getTeehrLocations: (params) => getJSON(url('getTeehrLocations'), params),
  getTeehrVariables: (params) => getJSON(url('getTeehrVariables'), params),
  getTeehrTimeSeries: (params) => getJSON(url('getTeehrTimeSeries'), params),

  createUpload: (params) => postJSON(url('createUpload'), params),
  startUpload: (params) => postJSON(url('startUpload'), params),
  uploadStatus: (params) => getJSON(url('uploadStatus'), params),
  uploadRunUrl: () => url('uploadRun'),
};

export default appAPI;
