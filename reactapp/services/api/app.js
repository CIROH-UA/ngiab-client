import apiClient from "services/api/client";

const APP_ROOT_URL = process.env.TETHYS_APP_ROOT_URL;

const appAPI = {
    getPlotData: () => {
        return apiClient.get(`${APP_ROOT_URL}data/`);
    },
    getNexusGeoJson: () => {
        return apiClient.get(`${APP_ROOT_URL}getNexuslayer/`);
    },
    getNexusTimeSeries: (params) => {
        return apiClient.get(`${APP_ROOT_URL}getNexusTimeSeries/`, { params });
    },
};

export default appAPI;