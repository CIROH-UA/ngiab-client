import { Fragment, useState,Suspense, useEffect } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { HydroFabricContainer, MapContainer } from '../../components/StyledContainers';
import { ToastContainer } from 'react-toastify';
import styled from 'styled-components';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import TimeSeriesView from '../ngiab/ts.js';
import MapComponent from 'features/DataStream/components/mapg.js';
import DataStreamMenuView from 'features/DataStream/views/dataStreamMenuView.js';


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

  

  return (
    <ViewContainer>
        {/* <DataStreamProvider> */}
          <HydroFabricProvider>
            <ToastContainer stacked  />

              <MapContainer 
                $fullScreen={singleRowOn}
              >
                <MapComponent />
              </MapContainer >
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
                  <TimeSeriesView 
                    singleRowOn={singleRowOn} 
                  />
                </Suspense>
              </HydroFabricContainer>
          </HydroFabricProvider>
        {/* </DataStreamProvider> */}


    </ViewContainer>
  );
};

export default DataStreamView;
