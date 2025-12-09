import { Fragment, useState, lazy,Suspense } from 'react';
import { HydroFabricProvider } from 'old/features/hydroFabric/providers/hydroFabricProvider';
import { ModelRunsProvider } from 'old/features/ModelRuns/providers/modelRunsProvider';
import { HydroFabricContainer, MapContainer } from '../../components/styles';
import { ToastContainer } from 'react-toastify';
import Button from 'react-bootstrap/Button';
import styled from 'styled-components';
import { GoGraph,GoChevronDown  } from "react-icons/go";
import LoadingAnimation from 'components/loader/LoadingAnimation';
// import HydroFabricView from '../../features/DataStream/old/hydroFabricView.js';
import MapComponent from 'old/features/Map/components/mapgl.js';
import ModelRunsView from 'old/features/ModelRuns/views/modelsView.js';

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
  const [singleRowOn, toggleSingleRow] = useState(true);
  const [isModelRunListOpen, setIsModelRunListOpen] = useState(true);
  const [ isLoading, setIsLoading ] = useState(false);

  return (
    <ViewContainer>
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
                $fullScreen={singleRowOn}
                
              >
                <MapComponent />
              </MapContainer>
              <ToggleButton $fullScreen={singleRowOn}  onClick={() => toggleSingleRow(prev => !prev)}>
                {singleRowOn ? <GoGraph size={20} /> : <GoChevronDown size={20} />}
              </ToggleButton>
              <HydroFabricContainer 
                $fullScreen={singleRowOn} 
                isModelRunListOpen={isModelRunListOpen}  
              >
                <Suspense fallback={<LoadingAnimation />}>
                  {/* <HydroFabricView 
                    singleRowOn={singleRowOn} 
                  /> */}
                </Suspense>
              </HydroFabricContainer>
          </HydroFabricProvider>
        </ModelRunsProvider>


    </ViewContainer>
  );
};

export default NGIABView;
