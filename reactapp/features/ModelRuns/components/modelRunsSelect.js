


import React, { useEffect, useState, Fragment,lazy } from 'react';
import styled from 'styled-components';
import Button from 'react-bootstrap/Button';
import { FaList } from "react-icons/fa";
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';

import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';



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
  top: 80px;
  // left: 25px;
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

  a {
    color: white;
  }
`;



const ModelRunsSelect = ({
  isopen,
  handleIsOpen,
  currentMenu
}) => {

  const {state,actions} = useModelRunsContext();
  const {actions: hydroFabricActions} = useHydroFabricContext();

  useEffect(() => {
    appAPI.getModelRuns().then((response) => {
      
      actions.set_model_run_list(response.model_runs);
    }).catch((error) => {
      console.log("Error fetching Model Runs", error);
      hydroFabricActions.reset();
    })
    return  () => {
      if(state.model_runs.length < 0) return
      actions.reset();
    }

  }, []);
  
  useEffect(() => {
    hydroFabricActions.reset();
    if (state.current_model_runs.length < 1){
      return
    }
    actions.set_base_model_id(state.current_model_runs[0].value)
    
  }
  , [state.current_model_runs]);

  return (
    <Fragment>
          
          {
            !isopen && 
            <OverlayTrigger
              key={'right'}
              placement={'right'}
              overlay={
                <Tooltip id={`tooltip-right`}>
                  Model Runs
                </Tooltip>
              }
            >
              <TogggledButton onClick={handleIsOpen} currentMenu={currentMenu} >
                <FaList size={15} />
              </TogggledButton>
            </OverlayTrigger>
          }
          <Container isOpen={isopen}>
            <Content>
              <h5>NGIAB Model Runs Available</h5>
              {state.model_runs.length > 0 &&
                  <Fragment>
                      <SelectComponent 
                        optionsList={state.model_runs} 
                        onChangeHandler={actions.set_current_model_runs}
                      />
                  </Fragment>
              }
            </Content>
          </Container>
    </Fragment>

  );
};

export default ModelRunsSelect;