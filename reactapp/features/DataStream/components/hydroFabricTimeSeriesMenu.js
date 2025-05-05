import React, { Fragment } from 'react';
import styled from 'styled-components';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import Button from 'react-bootstrap/Button';
import { GoGraph  } from "react-icons/go";
import { IoMdClose } from "react-icons/io";

const ToggleButton = styled(Button)`
  top: 300px;
  left: ${(props) => (props.$currentMenu ? '21%' : '20px')};
  position: absolute;

  margin-top: 10px;

  transition: transform 0.3s ease;

  background-color: #009989;
  border: none;
  color: white;
  border-radius: 5px;
  padding: 3px 10px;
  z-index: 1001;

  &:hover {
    background-color: #000000b3;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

const HydroFabricTimeSeriesMenu = ({
  toggleSingleRow,
  currentMenu,
  singleRowOn
}) => {
  
  
  return (
    <Fragment>
            <OverlayTrigger
              key={'right'}
              placement={'right'}
              overlay={
                <Tooltip id={`tooltip-right`}>
                  Time Series
                </Tooltip>
              }
            >
                <ToggleButton $currentMenu={currentMenu}  onClick={() => toggleSingleRow(prev => !prev)}>
                    {singleRowOn ? <GoGraph size={10} /> : <IoMdClose size={10} />}
                </ToggleButton>
            </OverlayTrigger>
    </Fragment>

  );
};

export default HydroFabricTimeSeriesMenu;