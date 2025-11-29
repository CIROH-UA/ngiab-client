import { Fragment, useState,Suspense, useEffect } from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { DataStreamProvider } from 'features/DataStream/providers/dataStreamProvider';
import {useDataStreamContext} from 'features/DataStream/hooks/useDataStreamContext';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';
import { HydroFabricContainer, MapContainer } from '../../components/StyledContainers';
import { ToastContainer } from 'react-toastify';
import styled from 'styled-components';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import HydroFabricView from '../ngiab/ts.js';
import MapComponent from 'features/Map/components/mapg.js';
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
        <DataStreamProvider>
          <HydroFabricProvider>
            <ToastContainer stacked  />

              <MapContainer 
                $fullScreen={singleRowOn}
              >
                <MapComponent  
                  cs_context={useDataStreamContext}
                  ts_store={useTimeSeriesStore}
                />
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
                  <HydroFabricView 
                    singleRowOn={singleRowOn} 
                  />
                </Suspense>
              </HydroFabricContainer>
          </HydroFabricProvider>
        </DataStreamProvider>


    </ViewContainer>
  );
};

export default DataStreamView;
