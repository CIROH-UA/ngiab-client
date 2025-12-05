import React, { Fragment } from 'react';
import ForecastMenu from 'features/DataStream/components/menus/forecastMenu';
import { LayersMenu } from './menus/layersMenu';


const MainMenu = () => {
  return (
    <Fragment>
        <ForecastMenu />
        <LayersMenu />
    </Fragment>
  );
};

export default MainMenu;