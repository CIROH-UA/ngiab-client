import { useState, Suspense} from 'react';
import { MapContainer } from 'features/DataStream/components/styles/styles';
import { ToastContainer } from 'react-toastify';
import styled from 'styled-components';
import MapComponent from 'features/DataStream/components/mapg.js';
import MainMenu from 'features/DataStream/components/mainMenu';
import 'maplibre-gl/dist/maplibre-gl.css';


const ViewContainer = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;


const DataStreamView = () => {
  
  return (
    <ViewContainer>
            <ToastContainer stacked  />
            <MapContainer>
              <MapComponent/>
            </MapContainer >
            <MainMenu/>
    </ViewContainer>
  );
};

export default DataStreamView;
