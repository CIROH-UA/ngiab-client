import { useState,Suspense, useContext  } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { ModelRunsProvider } from 'features/ModelRuns/providers/modelRunsProvider';
import { HydroFabricContainer, MapContainer } from '../../components/StyledContainers';
import { ToastContainer } from 'react-toastify';
import styled from 'styled-components';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import HydroFabricView from './hydroFabricView.js';
import MapComponent from 'features/Map/components/mapgl.js';
import ModelRunMenuView from 'features/ModelRuns/views/modelRunMenuView';
import { AppContext } from "context/context";

const ViewContainer = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const NGIABView = () => {
  const { backend } = useContext(AppContext);
  
  const [singleRowOn, toggleSingleRow] = useState(true);
  const [isModelRunListOpen, setIsModelRunListOpen] = useState(true);
  const [ isLoading, setIsLoading ] = useState(false);

  return (
    <ViewContainer>
        <ModelRunsProvider>
          <HydroFabricProvider>
            <ToastContainer stacked  />
              <MapContainer 
                $fullScreen={singleRowOn} 
              >
                <MapComponent />
              </MapContainer>
              <ModelRunMenuView
                  toggleSingleRow={toggleSingleRow} 
                  setIsLoading={setIsLoading}
                  setIsMenuOpen={setIsModelRunListOpen}
                  singleRowOn={singleRowOn}
              />
              <HydroFabricContainer 
                $fullScreen={singleRowOn} 
                isModelRunListOpen={isModelRunListOpen}  
              >
                <Suspense fallback={<LoadingAnimation />}>
                  <HydroFabricView 
                    singleRowOn={singleRowOn} 
                  />
                </Suspense>
              </HydroFabricContainer>
          </HydroFabricProvider>
        </ModelRunsProvider>


    </ViewContainer>
  );
};

export default NGIABView;
