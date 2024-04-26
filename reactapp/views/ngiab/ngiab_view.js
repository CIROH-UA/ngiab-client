import React, { Fragment, useState } from 'react';
// import Map from 'features/Map/components/Map';
import MapView from './map_view';
import HydroFabricView from './hydroFabricView';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';
import { MapProvider } from 'features/Map/providers/MapProvider';
import { HydroFabricContainer, MapContainer } from './containers';
const NGIABView = () => {
  const [singleRowOn, toggleSingleRow] = useState(true);

  return (
    <Fragment>
        <HydroFabricProvider>

            <MapContainer fullScreen={singleRowOn}>
              <MapProvider>
                  <MapView  />
              </MapProvider>
            </MapContainer>

            <HydroFabricContainer fullScreen={singleRowOn} >
              <HydroFabricView toggleSingleRow = {toggleSingleRow} />
            </HydroFabricContainer>

        </HydroFabricProvider>

    </Fragment>
  );
};

export default NGIABView;
