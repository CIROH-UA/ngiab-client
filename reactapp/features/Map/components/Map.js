import React, { Fragment, useEffect } from 'react';
import { MapProvider } from './MapProvider';

const Map = ({ children, layers=[] }) => {

  return (
    <Fragment>
      <MapProvider layers={layers}>
          {children}
      </MapProvider>
    </Fragment>
  );
};

export default Map;
  