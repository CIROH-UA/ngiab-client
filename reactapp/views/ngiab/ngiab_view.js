import React, { Fragment, useEffect, useCallback } from 'react';
import Map from 'features/Map/components/Map';
import MapView from './map_view';



const NGIABView = () => {

  return (
    <Fragment>
        <Map>
            <MapView/>
        </Map>
    </Fragment>
  );
};

export default NGIABView;
