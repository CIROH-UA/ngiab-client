import React from 'react';
import { MapContainer, ViewContainer } from 'features/DataStream/components/styles/styles';
import { ToastContainer } from 'react-toastify';
import MapComponent from 'features/DataStream/components/mapg.js';
import MainMenu from 'features/DataStream/components/mainMenu';
import 'maplibre-gl/dist/maplibre-gl.css';



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
