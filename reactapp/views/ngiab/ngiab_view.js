import { Fragment, useState, lazy,Suspense } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { ModelRunsProvider } from 'features/ModelRuns/providers/modelRunsProvider';
import { HydroFabricContainer, MapContainer } from '../../components/StyledContainers';
import { ToastContainer } from 'react-toastify';


import LoadingAnimation from 'components/loader/LoadingAnimation';

const HydroFabricView = lazy(() => import('./hydroFabricView.js'));
const MapComponent = lazy(() => import('features/Map/components/mapgl.js'));
const ModelRunsView = lazy(() => import('features/ModelRuns/views/modelsView.js'));
// const SelectionView = lazy(() => import('./selections'));

const NGIABView = () => {
  const [singleRowOn, toggleSingleRow] = useState(true);
  const [isModelRunListOpen, setIsModelRunListOpen] = useState(true);
  const [ isLoading, setIsLoading ] = useState(false);

  return (
    <Fragment>
        <ModelRunsProvider>
          <HydroFabricProvider>
            <ToastContainer stacked  />
            <ModelRunsView
              singleRowOn={singleRowOn}
              toggleSingleRow={toggleSingleRow}
              setIsLoading={setIsLoading}
              setIsModelRunListOpen={setIsModelRunListOpen}
            />
              <MapContainer 
                fullScreen={singleRowOn}
                
              >
                <MapComponent />
              </MapContainer>
              <HydroFabricContainer 
                fullScreen={singleRowOn} 
                isModelRunListOpen={isModelRunListOpen}  
              >
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
