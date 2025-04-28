import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import HydrofabricMapControl from 'features/hydroFabric/components/hydrofabricMapControl';

import Button from 'react-bootstrap/Button';
import { IoMdClose } from "react-icons/io";
import { IoLayers } from "react-icons/io5";

const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  width: 20%;
  background-color: #4f5b67;

  
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

// const TogggledButton = styled(Button)`
//   top: ${({ isOpen }) => isOpen ? '80px;' : '140px;'};
//   left: ${({ isOpen }) => isOpen ? '18%;' : '25px;'};
//   position: absolute;
  
//   margin-top: 10px;

//   // transform: translate(-50%, -50%);
//   transition: transform 0.3s ease;
//   // transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-90%))'};

//   background-color: rgba(255, 255, 255, 0.1);
//   border: none;
//   color: white;
//   border-radius: 5px;
//   padding: 7px 8px;
//   z-index: 1001;

//   &:hover, &:focus {
//     background-color: rgba(0, 0, 0, 0.1)!important;
//     color: white;
//     border: none;
//     box-shadow: none;
//   }
// `;

const TogggledButton = styled(Button)`
  top: 140px;
  left: 25px;
  position: absolute;
  
  margin-top: 10px;

  // transform: translate(-50%, -50%);
  transition: transform 0.3s ease;
  // transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-90%))'};

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



const Content = styled.div`
  padding: 16px;
  margin-top: 100px;
`;



const HydrofabricLayerMenu = ({
  isopen,
  // setIsOpen
  handleIsOpen
}) => {
  // const [isOpen, setIsOpen] = useState(false);
  
  const toggleContainer = () => {
    setIsOpen();
    // setIsOpen(prev => !prev);
    
  };


  
  return (
    <Fragment>
          {/* <TogggledButton onClick={toggleContainer} isOpen={isopen}>
            {isopen ? <IoMdClose size={20} /> : <IoLayers size={20} />}
          </TogggledButton> */}
          {
            !isopen && <TogggledButton onClick={handleIsOpen}>
               <IoLayers size={20} />
            </TogggledButton>
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