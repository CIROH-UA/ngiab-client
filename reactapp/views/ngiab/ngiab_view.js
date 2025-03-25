import { Fragment, useState, lazy,Suspense } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { ModelRunsProvider } from 'features/ModelRuns/providers/modelRunsProvider';
import { HydroFabricContainer, MapContainer } from '../../components/StyledContainers';
import LoadingAnimation from 'components/loader/LoadingAnimation';

const HydroFabricView = lazy(() => import('./hydroFabricView.js'));
const MapComponent = lazy(() => import('features/Map/components/mapgl.js'));
const ModelRunsComponent = lazy(() => import('features/ModelRuns/views/modelsView.js'));

const NGIABView = () => {
  const [singleRowOn, toggleSingleRow] = useState(true);
  const [ isLoading, setIsLoading ] = useState(false);

  return (
    <Fragment>
        <ModelRunsProvider>
          <HydroFabricProvider>
              <ModelRunsComponent />
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
        </ModelRunsProvider>


    </Fragment>
  );
};

export default NGIABView;
