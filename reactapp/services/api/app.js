import apiClient from "services/api/client";

const APP_ROOT_URL = process.env.TETHYS_APP_ROOT_URL;

const appAPI = {
    getNexusTimeSeries: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getNexusTimeSeries/`, { params });
    },
    getCatchmentTimeSeries: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getCatchmentTimeSeries/`, { params });
    },
    getTrouteVariables: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getTrouteVariables/`, { params });
    },
    getTrouteTimeSeries: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getTrouteTimeSeries/`, { params });
    },
    getTeehrTimeSeries: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getTeehrTimeSeries/`, { params });
    },
    getTeehrVariables: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getTeehrVariables/`, { params });
    },
    getGeoSpatialData: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getGeoSpatialData/`, {params});
    },
    getModelRuns: () => {
        return apiClient.get(`${APP_ROOT_URL}getModelRuns/`);
    },
    // Data Stream API
    makeDatastreamConf:()   => {
        return apiClient.get(`${APP_ROOT_URL}makeDatastreamConf/`);
    },
    getDataStreamNgiabDates: () => {
        return apiClient.get(`${APP_ROOT_URL}getDataStreamNgiabDates/`);
    },
    getDataStreamNgiabAvailableForecast: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getDataStreamNgiabAvailableForecast/`, { params });
    },
    getDataStreamNgiabAvailableCycles: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getDataStreamNgiabAvailableCycles/`, { params });
    },
    getDataStreamNgiabAvailableEnsembles:(params) => {
        return apiClient.get(`${APP_ROOT_URL}getDataStreamNgiabAvailableEnsembles/`, { params });
    },
    getDataStreamNgiabAvailableVpus: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getDataStreamNgiabAvailableVpus/`, { params });
    },
    getDataStreamTarFile: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getDataStreamTarFile/`, { params });
    },
    getDataStreamModelRuns: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getDataStreamModelRuns/`, { params });
    },
    importModelRuns: (params) => {
        return apiClient.get(`${APP_ROOT_URL}importModelRuns/`, { params });
    }
    


}
 
export default appAPI;