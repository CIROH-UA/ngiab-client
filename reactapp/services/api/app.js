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
    getDataStreamNgenDates: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getDataStreamNgenDates/`, { params });
    },
    importModelRuns: (params) => {
        return apiClient.get(`${APP_ROOT_URL}importModelRuns/`, { params });
    }


}
 
export default appAPI;