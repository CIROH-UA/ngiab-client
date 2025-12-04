import React, { Fragment } from 'react';
import DataMenu from './DataMenu';
import { FaList } from "react-icons/fa";
import { MdSsidChart,MdInfoOutline  } from "react-icons/md";
import { IconLabel, Title, Container, ToggleButton } from './StyledComponents/ts';
import { Content } from './StyledComponents/ts';
import { LayerControl } from './layersControl';

const DataStreamMenu = ({
  isopen,
  handleIsOpen,
  currentMenu
}) => {

  return (
    <Fragment>
          
          {
            !isopen && 
              <ToggleButton onClick={handleIsOpen} $currentMenu={currentMenu} $top={80} >
                <FaList size={15} />
              </ToggleButton> 
          }
          <Container $isOpen={isopen}>
            <Content>
              <IconLabel>
                <MdSsidChart />
                <Title>
                  Data Options
                </Title>
                <MdInfoOutline  />
              </IconLabel>
              
              <DataMenu />
              <LayerControl />
            </Content>

            
          </Container>
    </Fragment>

  );
};

export default DataStreamMenu;