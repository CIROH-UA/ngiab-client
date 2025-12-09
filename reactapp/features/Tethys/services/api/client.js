import axios from 'axios';

import { getTethysPortalHost } from 'features/Tethys/services/utilities';
import tethysAPI from 'features/Tethys/services/api/tethys';

const TETHYS_PORTAL_HOST = getTethysPortalHost();

axios.defaults.xsrfHeaderName = "X-CSRFTOKEN"
axios.defaults.xsrfCookieName = "csrftoken"

const apiClient = axios.create({
  baseURL: `${TETHYS_PORTAL_HOST}`,
  // withCredentials: true,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },
});

function handleSuccess(response) {
  return response.data ? response.data : response;
}

function handleError(error) {

  let res = error.response;
  if (res.status === 401) {
    // Redirect to Tethys Portal login
    window.location.assign(`${TETHYS_PORTAL_HOST}/accounts/login?next=${window.location.pathname}`);
  }
  return Promise.reject(error);
}

apiClient.interceptors.response.use(handleSuccess, handleError);

export default apiClient;