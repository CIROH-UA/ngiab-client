import { Fragment, useState, lazy,Suspense } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { HydroFabricContainer, MapContainer } from './containers';
import LoadingAnimation from 'components/loader/LoadingAnimation';
const HydroFabricView = lazy(() => import('./hydroFabricView.js'));
const MapComponent = lazy(() => import('features/Map/components/mapgl.js'));
const NGIABView = () => {
  const [singleRowOn, toggleSingleRow] = useState(true);
  const [ isLoading, setIsLoading ] = useState(false);

  return (
    <Fragment>
        <HydroFabricProvider>
            <MapContainer fullScreen={singleRowOn}>
              <MapComponent />
            </MapContainer>
            <HydroFabricContainer fullScreen={singleRowOn} >
              <Suspense fallback={<LoadingAnimation />}>
                <HydroFabricView 
                  toggleSingleRow = {toggleSingleRow} 
                  singleRowOn={singleRowOn} 
                  setIsLoading={setIsLoading} 
                />
              </Suspense>
            </HydroFabricContainer>
        </HydroFabricProvider>

    </Fragment>
  );
};

export default NGIABView;
