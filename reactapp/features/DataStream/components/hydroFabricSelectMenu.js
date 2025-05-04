import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
// import TimeSeriesSelection from 'features/ModelRuns/components/timeSeriesSelect';
import HydroFabricSelect from 'features/DataStream/components/hydroFabricSelect';

import Button from 'react-bootstrap/Button';
import { IoMdClose, IoIosOptions  } from "react-icons/io";


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

const TogggledButton = styled(Button)`
  // top: ${({ isOpen }) => isOpen ? '80px;' : '140px;'};
  // left: ${({ isOpen }) => isOpen ? '18%;' : '25px;'};

  top: 200px;
  left: ${({ currentMenu }) => currentMenu ? '21%' : '20px'};
  position: absolute;
  
  margin-top: 10px;

  // transform: translate(-50%, -50%);
  transition: transform 0.3s ease;
  // transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-90%))'};

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
  // setIsOpen,
  // singleRowOn,
  toggleSingleRow,
  setIsLoading,
  currentMenu
}) => {
  
  
  const toggleContainer = () => {
    setIsOpen(prev => !prev);
  };


  return (
    <Fragment>
          {
            !isopen && <TogggledButton onClick={handleIsOpen} currentMenu={currentMenu}>
               <IoIosOptions size={10} />
            </TogggledButton>
          }

          {/* <TogggledButton onClick={toggleContainer} isOpen={isopen}>
            {isopen ? <IoMdClose size={20} /> : <IoIosOptions size={20} />}
          </TogggledButton> */}
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