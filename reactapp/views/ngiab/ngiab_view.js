import { Fragment, useState, lazy } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { MapProvider } from 'features/Map/providers/MapProvider';
import { HydroFabricContainer, MapContainer } from './containers';

const HydroFabricView = lazy(() => import('./hydroFabricView.js'));
const MapView = lazy(() => import('./map_view.js'));

const NGIABView = () => {
  const [singleRowOn, toggleSingleRow] = useState(true);
  const [ isLoading, setIsLoading ] = useState(false);

  return (
    <Fragment>
        <HydroFabricProvider>
            <MapContainer fullScreen={singleRowOn}>
              <MapProvider>
                  <MapView 
                    isLoading={isLoading} 
                    setIsLoading={setIsLoading} 
                  />
              </MapProvider>
            </MapContainer>
            <HydroFabricContainer fullScreen={singleRowOn} >
              <HydroFabricView 
                toggleSingleRow = {toggleSingleRow} 
                singleRowOn={singleRowOn} 
                setIsLoading={setIsLoading} 
              />
            </HydroFabricContainer>
        </HydroFabricProvider>

    </Fragment>
  );
};

export default NGIABView;
