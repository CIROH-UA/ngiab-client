import React, { Fragment, useState } from 'react';
import { LayerControl } from '../layersControl';
import { LayersContainer, LayerButton } from '../styles/styles';
import { IoLayers, IoClose } from "react-icons/io5";

export const LayersMenu = () => {
  const [open, setIsOpen] = useState(false);

  return (
    <Fragment>
      {open ? (
        <>
          <LayerButton
            $bgColor="#ffffff00"
            onClick={() => setIsOpen(prev => !prev)}
          >
            <IoClose size={20} />
          </LayerButton>

          <LayersContainer isOpen={open}>
            <LayerControl />
          </LayersContainer>
        </>
      ) : (
        <LayerButton onClick={() => setIsOpen(prev => !prev)}>
          <IoLayers size={20} />
        </LayerButton>
      )}
    </Fragment>
  );
};
