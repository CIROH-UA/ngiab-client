import React from 'react';
import { MapContainer, ViewContainer } from 'features/DataStream/components/styles/Styles';
import { ToastContainer } from 'react-toastify';
import MapComponent from 'features/DataStream/components/map/Mapg.js';
import MainMenu from 'features/DataStream/components/menus/MainMenu';
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
