import React, { Fragment, useState } from 'react';
import styled from 'styled-components';

import TimeSeriesSelection from 'features/ModelRuns/components/timeSeriesSelect';
import HydrofabricMapControl from 'features/hydroFabric/components/hydrofabricMapControl';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
// import { useDataStreamModelRunsContext } from 'features/DataStream/hooks/useDataStreamModelRunsContext';
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import Button from 'react-bootstrap/Button';
import DataStreamMenu from 'features/DataStream/components/dataStreamMenu';
import HydrofabricLayerMenu from 'features/DataStream/components/hydroFabricLayerMenu';
import HydroFabricSelectMenu from 'features/DataStream/components/hydroFabricSelectMenu';
import DataStreamMenuWrapper from 'features/DataStream/components/dataStreamMenuWrapper';
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
  top: 80px;
  left: 25px;
  position: absolute;

  transform: translate(-50%, -50%);
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


// Content inside the panel.
const Content = styled.div`
  padding: 16px;
  margin-top: 100px;
`;

const DataStreamMenuView = ({
  singleRowOn,
  toggleSingleRow,
  setIsLoading,
  setIsDataStreamMenuOpen,
  
}) => {
  
  const [isopen, setIsOpen] = useState(false);
  const [isDataStreamOpen, setIsDataStreamOpen] = useState(true);
  
  const { state } = useModelRunsContext();
  const isVisible = state.base_model_id ? true : false;
  
  const toggleContainer = () => {
    setIsOpen(prev => !prev);
    setIsDataStreamMenuOpen(prev => !prev);
  };

  return (
    <Fragment>
      <DataStreamMenuWrapper/>
      {/* <DataStreamMenu 
        isopen={isopen}
        setIsOpen={setIsOpen}
      />
      <HydrofabricLayerMenu 
        isopen={isopen}
        setIsOpen={setIsOpen}
      /> */}
      {/* <HydroFabricSelectMenu
        isopen={isopen}
        setIsOpen={setIsOpen}
        // singleRowOn={singleRowOn}
        toggleSingleRow={toggleSingleRow}
        setIsLoading={setIsLoading}
      /> */}
      {/* <TimeSeriesMenu
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        singleRowOn={singleRowOn}
        toggleSingleRow={toggleSingleRow}
        setIsLoading={setIsLoading}
      /> */}
      
      {/* <TogggledButton onClick={toggleContainer}>
        {isOpen ? <FaChevronLeft size={20} /> : <FaChevronRight size={20} />}
      </TogggledButton>
      <Container isOpen={isOpen}>
        <Content>
          <DataStreamMenu/>
          <TimeSeriesSelection
              singleRowOn={singleRowOn}
              toggleSingleRow={toggleSingleRow}
              setIsLoading={setIsLoading}
          />
          <HydrofabricMapControl
              isVisible={isVisible}
          />
        </Content>
      </Container> */}
    </Fragment>

  );
};

export default DataStreamMenuView;