import React, { Fragment } from 'react';
import styled from 'styled-components';
import HydrofabricMapControl from 'old/features/hydroFabric/components/hydrofabricMapControl';
import Button from 'react-bootstrap/Button';
import { IoLayers } from "react-icons/io5";
import { Container } from '../../components/styles/styles';
// const Container = styled.div`
//   position: absolute;
//   top: 0;
//   left: 0;
//   height: 100vh;
//   width: 20%;
//   background-color: #4f5b679e;
//   color: #fff;
  
//   z-index: 1000;
//   transition: transform 0.3s ease;
//   /* When closed, shift left so that only 40px remains visible */
//   transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100% ))'};

//   /* On small screens, use 100% width */
//   @media (max-width: 768px) {
//     width: 100%;
//     transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100%))'};
//   }
// `;


const ToggleButton = styled(Button)`
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
              <ToggleButton onClick={handleIsOpen} currentMenu={currentMenu}>
                <IoLayers size={15} />
              </ToggleButton>
          }

          <Container $isOpen={isopen}>
            <Content>
                <HydrofabricMapControl isVisible={isopen} />
            </Content>
          </Container>
    </Fragment>

  );
};

export default HydrofabricLayerMenu;