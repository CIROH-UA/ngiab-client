import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import Button from 'react-bootstrap/Button';

import DataStreamMenu from 'features/DataStream/components/dataStreamMenu';
// import HydrofabricLayerMenu from 'features/DataStream/old/components/hydroFabricLayerMenu';
// import HydroFabricSelectMenu from 'features/DataStream/components/hydroFabricSelectMenu';
// import TimeSeriesMenu from 'features/DataStream/components/TimeSeriesMenu';
// import {LayerControl} from './layersControl';
import { IoMdClose } from "react-icons/io";
import { LayersMenu } from './layersMenu';

const TogggledButton = styled(Button)`
  top: 60px;
  left: 1%;
  position: absolute;
  margin-top: 10px;

  // transform: translate(-50%, -50%);
  transition: transform 0.3s ease;

  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  border-radius: 5px;
  padding: 7px 8px;
  z-index: 1001;

  &:hover, &:focus {
    background-color: rgba(0, 0, 0, 0.1)!important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;



const DataStream = ({
  toggleSingleRow,
  setIsLoading,
  setIsDataStreamMenuOpen,
  singleRowOn
}) => {
  const [isBucketDatesOpen, setIsBucketDatesOpen] = useState(false);
  const [isHydroFabricSelectOpen, setIsHydroFabricSelectOpen] = useState(false);
  const [isHydroFabricLayerOpen, setIsHydroFabricLayerOpen] = useState(false);
  const [currentMenu, setCurrentMenu] = useState(null);
  
  const handleBucketS3Menu = () => {
    setIsBucketDatesOpen(prev => !prev);
    setIsHydroFabricSelectOpen(false);
    setIsHydroFabricLayerOpen(false);
    setCurrentMenu(true);
    setIsDataStreamMenuOpen(true);

  };

  const handleClose = () => {
    setIsBucketDatesOpen(false);
    setIsHydroFabricSelectOpen(false);
    setIsHydroFabricLayerOpen(false);
    setCurrentMenu(null);
    setIsDataStreamMenuOpen(false);

  }

  return (
    <Fragment>
        {
          currentMenu &&
          <TogggledButton onClick={handleClose}>
            <IoMdClose size={20} />
          </TogggledButton>
        }

        <DataStreamMenu  
            isopen={isBucketDatesOpen}
            handleIsOpen={handleBucketS3Menu}
            currentMenu={currentMenu}
        />
        <LayersMenu />        

    </Fragment>

  );
};

export default DataStream;