import React, { Fragment } from 'react';
import ForecastMenu from 'features/DataStream/components/menus/ForecastMenu';
import { LayersMenu } from './LayersMenu';


const MainMenu = () => {
  return (
    <Fragment>
        <ForecastMenu />
        <LayersMenu />
    </Fragment>
  );
};

export default MainMenu;