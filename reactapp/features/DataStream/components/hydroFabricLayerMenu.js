import React, { Fragment } from 'react';
import styled from 'styled-components';
import HydrofabricMapControl from 'features/hydroFabric/components/hydrofabricMapControl';
import Button from 'react-bootstrap/Button';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { IoLayers } from "react-icons/io5";

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
  top: 140px;
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



const HydrofabricLayerMenu = ({
  isopen,
  handleIsOpen,
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
                  Hydrofabric Layers
                </Tooltip>
              }
            >
              <TogggledButton onClick={handleIsOpen} currentMenu={currentMenu}>
                <IoLayers size={10} />
              </TogggledButton>
            </OverlayTrigger>

          }

          <Container isOpen={isopen}>
            <Content>
                <HydrofabricMapControl isVisible={isopen} />
            </Content>
          </Container>
    </Fragment>

  );
};

export default HydrofabricLayerMenu;