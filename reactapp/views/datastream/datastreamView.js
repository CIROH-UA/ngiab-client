import { Fragment, useState,Suspense, useEffect } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { ModelRunsProvider } from 'features/ModelRuns/providers/modelRunsProvider';
// import { DataStreamModelRunsProvider } from 'features/DataStream/providers/dataStreamModelRunsProvider';
import { HydroFabricContainer, MapContainer } from '../../components/StyledContainers';
import { ToastContainer } from 'react-toastify';
import Button from 'react-bootstrap/Button';
import styled from 'styled-components';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import HydroFabricView from '../ngiab/hydroFabricView.js';
import MapComponent from 'features/Map/components/mapgl.js';
import DataStreamMenuView from 'features/DataStream/views/dataStreamMenuView.js';
import appAPI from 'services/api/app';


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
