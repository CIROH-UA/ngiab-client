import React, { Fragment, useEffect, useCallback } from 'react';
import Map from 'features/Map/components/Map';
import MapView from './map_view';
import HydroFabricView from './hydroFabricView';
import { HydroFabricProvider } from 'features/hydroFabric/providers/hydroFabricProvider';

const NGIABView = () => {

  return (
    <Fragment>
        <HydroFabricProvider>
            <Map>
                <MapView/>
            </Map>
            <HydroFabricView/>
        </HydroFabricProvider>

    </Fragment>
  );
};

export default NGIABView;
