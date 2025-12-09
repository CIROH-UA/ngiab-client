import apiClient from "services/api/client";
import tethysAPI from "services/api/tethys";

const APP_ROOT_URL = process.env.TETHYS_APP_ROOT_URL;

const appAPI = {
    getParquetPerVpu: (data) => {
        return apiClient.post(
            `${APP_ROOT_URL}getParquetPerVpu/`, 
            { ...data },
            {
                responseType: "arraybuffer",          // key point: binary, not JSON
                headers: { "Content-Type": "application/json" },
            }
            // { headers: { ...headers } }
       );
    }


}
 
export default appAPI;