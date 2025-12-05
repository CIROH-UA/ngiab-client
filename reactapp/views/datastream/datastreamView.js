import { useState, Suspense} from 'react';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { MapContainer } from '../../components/StyledContainers';
import { ToastContainer } from 'react-toastify';
import styled from 'styled-components';
import MapComponent from 'features/DataStream/components/mapg.js';
import DataStreamMenuView from 'features/DataStream/views/dataStreamMenuView.js';
import 'maplibre-gl/dist/maplibre-gl.css';


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
          </HydroFabricProvider>


    </ViewContainer>
  );
};

export default DataStreamView;
