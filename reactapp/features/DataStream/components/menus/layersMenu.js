import React, { Fragment, useEffect, useState } from 'react';
import styled from 'styled-components';
import Button from 'react-bootstrap/Button';
import { LayerControl } from '../layersControl';
import { Content, LayersContainer } from '../styles/styles';
import { IoLayers, IoClose } from "react-icons/io5";

const LayerButton = styled(Button)`
  top: 60px;
  right: 1%;
  position: absolute;
  margin-top: 10px;
  transition: transform 0.3s ease;
  background-color: #009989;
  border: none;
  color: white;
  border-radius: 20px;
  padding: 7px 8px;
  z-index: 1001;

  &:hover, &:focus {
    background-color: rgba(0, 0, 0, 0.1)!important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

export const LayersMenu = () => {
  const [open, setIsOpen] = useState(false);
  useEffect(() => {
    console.log('LayersMenu open state:', open);
  }, [open]);
  return (
    <Fragment>
      <LayerButton onClick={() => setIsOpen(prev => !prev)}>
        {!open ? <IoLayers size={20} />: <IoClose size={20} />}
      </LayerButton>

      {open && (
        <LayersContainer isOpen={open}>
            <Content>
                <LayerControl />
            </Content>
        </LayersContainer>
      )}
    </Fragment>
  );
};