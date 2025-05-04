import { Fragment, useState,Suspense, useEffect } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { ModelRunsProvider } from 'features/ModelRuns/providers/modelRunsProvider';
// import { DataStreamModelRunsProvider } from 'features/DataStream/providers/dataStreamModelRunsProvider';
import { HydroFabricContainer, MapContainer } from '../../components/StyledContainers';
import { ToastContainer } from 'react-toastify';
import Button from 'react-bootstrap/Button';
import styled from 'styled-components';
import { GoGraph  } from "react-icons/go";
import { IoMdClose } from "react-icons/io";

import LoadingAnimation from 'components/loader/LoadingAnimation';
import HydroFabricView from '../ngiab/hydroFabricView.js';
import MapComponent from 'features/Map/components/mapgl.js';
import DataStreamMenuView from 'features/DataStream/views/dataStreamMenuView.js';
import appAPI from 'services/api/app';

const ToggleButton = styled(Button)`
  // top: ${(props) => (props.$fullScreen ? '95%' : '65%;')};
  top: 300px;
  left: ${(props) => (props.$fullScreen ? '21%;' : '38px;')}
  // right: 0px;
  position: absolute;
  transform: translate(-50%, -50%);
  background-color: #009989;
  border: none;
  color: white;
  border-radius: 5px;
  padding: 3px 10px;
  z-index: 1001;
  
  &:hover, &:focus {
    background-color: #000000b3 !important;
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


const DataStreamView = () => {
  const [singleRowOn, toggleSingleRow] = useState(true);
  const [isDataStreamMenuOpen, setIsDataStreamMenuOpen] = useState(false);
  const [ isLoading, setIsLoading ] = useState(false);

  useEffect(() => {
    appAPI.makeDatastreamConf()
      .then((data) => {
        console.log('Success', data);
        if (data.error) {
          return;
        }
        // toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
      })
      .catch((error) => {
        console.error('Failed', error);
      });
  }
  , []);

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
              <DataStreamMenuView
                  toggleSingleRow={toggleSingleRow} 
                  setIsLoading={setIsLoading}
                  setIsDataStreamMenuOpen={setIsDataStreamMenuOpen}
                  singleRowOn={singleRowOn}
              />

              
              <HydroFabricContainer 
                $fullScreen={singleRowOn} 
                isModelRunListOpen={isDataStreamMenuOpen}  
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

export default DataStreamView;
