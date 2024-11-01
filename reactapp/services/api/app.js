import apiClient from "services/api/client";

const APP_ROOT_URL = process.env.TETHYS_APP_ROOT_URL;

const appAPI = {
    getNexusGeoJson: () => {
        return apiClient.get(`${APP_ROOT_URL}getNexuslayer/`);
    },
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
    }
}
 
export default appAPI;