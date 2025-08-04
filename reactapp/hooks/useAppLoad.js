import { useEffect, useState } from "react";
import tethysAPI from "services/api/tethys";
import Backend from "services/Backend";

export const APP_ID = process.env.TETHYS_APP_ID;
export const LOADER_DELAY = process.env.TETHYS_LOADER_DELAY;
export const TETHYS_APP_ROOT_URL = process.env.TETHYS_APP_ROOT_URL;

export function useAppLoad() {
  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [appContext, setAppContext] = useState(null);

  const handleError = (error) => {
    // Delay setting the error to avoid flashing the loading animation
    setTimeout(() => {
      setError(error);
    }, LOADER_DELAY);
  };

  useEffect(() => {
    // Get the session first
    tethysAPI
      .getSession()
        .then(() => {
          // Then load all other app data
          Promise.all([
            tethysAPI.getAppData(APP_ID),
            tethysAPI.getUserData(),
            tethysAPI.getCSRF(),
          ])
            .then(([tethysApp, user, csrfToken]) => {
              // Setup backend
              const backend = new Backend(TETHYS_APP_ROOT_URL);

              backend.connect(() => {
                console.log("Connected to backend.");
                setAppContext({
                  tethysApp,
                  user,
                  csrfToken,
                  backend,
                });

                // Allow for minimum delay to display loader
                setTimeout(() => {
                  setIsLoaded(true);
                }, LOADER_DELAY);
              });
            })
            .catch(handleError);
        })
        .catch(handleError);
  }, []);

  return { isLoaded, appContext, error };
}