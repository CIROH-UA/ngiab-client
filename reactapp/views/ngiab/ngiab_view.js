import { useState,Suspense, useContext  } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { ModelRunsProvider } from 'features/ModelRuns/providers/modelRunsProvider';
import { HydroFabricContainer, MapContainer } from '../../components/StyledContainers';
import { ToastContainer } from 'react-toastify';
import Button from 'react-bootstrap/Button';
import styled from 'styled-components';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import HydroFabricView from './hydroFabricView.js';
import MapComponent from 'features/Map/components/mapgl.js';
import ModelRunMenuView from 'features/ModelRuns/views/modelRunMenuView';
import { AppContext } from "context/context";

const ToggleButton = styled(Button)`
  top: ${(props) => (props.$fullScreen ? '95%' : '65%;')};
  right: 0px;
  position: absolute;
  transform: translate(-50%, -50%);
  background-color:rgba(153, 116, 116, 0.4);
  border: none;
  color: white;
  border-radius: 5px;
  padding: 7px 8px;
  z-index: 1001;
  
  &:hover, &:focus {
    background-color: rgba(0, 0, 0, 0.1)!important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

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
