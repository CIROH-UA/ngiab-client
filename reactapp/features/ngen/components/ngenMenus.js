import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import Button from 'react-bootstrap/Button';

import HydrofabricLayerMenu from 'features/ngen/components/hydroFabricLayerMenu';
import HydroFabricSelectMenu from 'features/ngen/components/hydroFabricSelectMenu';
import HydroFabricTimeSeriesMenu from 'features/ngen/components/hydroFabricTimeSeriesMenu';

import { IoMdClose } from "react-icons/io";


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



const NgenMenuWrapper = ({
  toggleSingleRow,
  setIsLoading,
  setIsNgenMenuOpen,
  singleRowOn,
  MenuComponent
}) => {
  const [isNgenOpen, setIsNgenOpen] = useState(false);
  const [isHydroFabricSelectOpen, setIsHydroFabricSelectOpen] = useState(false);
  const [isHydroFabricLayerOpen, setIsHydroFabricLayerOpen] = useState(false);
  const [currentMenu, setCurrentMenu] = useState(null);
  
  const handleBucketS3Menu = () => {
    setIsNgenOpen(prev => !prev);
    setIsHydroFabricSelectOpen(false);
    setIsHydroFabricLayerOpen(false);
    setCurrentMenu(true);
    setIsNgenMenuOpen(true);
  };

  const handleHydroLayerMenu = () => {
    setIsNgenOpen(false);
    setIsHydroFabricSelectOpen(false);
    setIsHydroFabricLayerOpen(prev => !prev);
    setCurrentMenu(true);
    setIsNgenMenuOpen(true);
  };

  const handleHydroSelectMenu = () => {
    setIsNgenOpen(false);
    setIsHydroFabricSelectOpen(prev => !prev);
    setIsHydroFabricLayerOpen(false);
    setCurrentMenu(true);
    setIsNgenMenuOpen(true);

  };

  const handleClose = () => {
    setIsNgenOpen(false);
    setIsHydroFabricSelectOpen(false);
    setIsHydroFabricLayerOpen(false);
    setCurrentMenu(null);
    setIsNgenMenuOpen(false);

  }

  return (
    <Fragment>
        {
          currentMenu &&
          <TogggledButton onClick={handleClose}>
            <IoMdClose size={20} />
          </TogggledButton>
        }

        <MenuComponent  
            isopen={isNgenOpen}
            handleIsOpen={handleBucketS3Menu}
            currentMenu={currentMenu}
        />

        <HydrofabricLayerMenu
            isopen={isHydroFabricLayerOpen}
            handleIsOpen={handleHydroLayerMenu}
            currentMenu={currentMenu}
        />
          
        <HydroFabricSelectMenu
          isopen={isHydroFabricSelectOpen}
          handleIsOpen={handleHydroSelectMenu}
          toggleSingleRow={toggleSingleRow}
          setIsLoading={setIsLoading}
          currentMenu={currentMenu}
        />

        <HydroFabricTimeSeriesMenu
          toggleSingleRow={toggleSingleRow}
          currentMenu={currentMenu}
          singleRowOn={singleRowOn}
        />

    </Fragment>

  );
};

export default NgenMenuWrapper;