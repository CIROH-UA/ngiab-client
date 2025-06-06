import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import HydroFabricSelect from 'features/DataStream/components/hydroFabricSelect';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import Button from 'react-bootstrap/Button';
import { IoIosOptions  } from "react-icons/io";


const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  width: 20%;
  background-color: #4f5b679e;
  color: #fff;
  
  z-index: 1000;
  transition: transform 0.3s ease;
  /* When closed, shift left so that only 40px remains visible */
  transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100% ))'};

  /* On small screens, use 100% width */
  @media (max-width: 768px) {
    width: 100%;
    transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100%))'};
  }
`;

const TogggledButton = styled(Button)`
  top: 200px;
  left: ${({ currentMenu }) => currentMenu ? '21%' : '20px'};
  position: absolute;
  
  margin-top: 10px;

  transition: transform 0.3s ease;

  background-color: #009989;
  border: none;
  color: white;
  border-radius: 5px;
  padding: 3px 10px;
  z-index: 1001;

  &:hover, &:focus {
    background-color: #000000b3 !important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;


const Content = styled.div`
  padding: 16px;
  margin-top: 100px;
`;



const HydroFabricSelectMenu = ({
  isopen,
  handleIsOpen,
  toggleSingleRow,
  setIsLoading,
  currentMenu
}) => {
  
  
  return (
    <Fragment>
          {
            !isopen && 
            <OverlayTrigger
              key={'right'}
              placement={'right'}
              overlay={
                <Tooltip id={`tooltip-right`}>
                  HydroFabric Menu
                </Tooltip>
              }
            >
            <TogggledButton onClick={handleIsOpen} currentMenu={currentMenu}>
               <IoIosOptions size={15} />
            </TogggledButton>
            </OverlayTrigger>            
            

          }
          <Container isOpen={isopen}>
            <Content>
                <HydroFabricSelect
                    isOpen={isopen}
                    toggleSingleRow={toggleSingleRow}
                    setIsLoading={setIsLoading}
                />
            </Content>
          </Container>
    </Fragment>

  );
};

export default HydroFabricSelectMenu;