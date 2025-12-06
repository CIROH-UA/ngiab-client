import React, { Fragment, useState } from 'react';
import DataMenu from '../../components/dataDialog';
import { FaList } from "react-icons/fa";
import { MdSsidChart,MdInfoOutline  } from "react-icons/md";
import { IconLabel, Title, Container, ToggleButton, SButton } from '../../components/styles/styles';
import { Content } from '../../components/styles/styles';
import { DataInfoModel } from '../../components/modals';
import TimeSeriesCard from '../../components/TimeseriesCard';

const ForecastMenu = ({
  isopen,
  handleIsOpen,
  currentMenu
}) => {
  const [ modalDataInfoShow, setModalDataInfoShow ] = useState(false)
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

              <TimeSeriesCard />
            </Content>
            <Content>
              <IconLabel>
                <MdSsidChart />
                <Title>
                  View Options
                </Title>
                <SButton bsPrefix='btn2' onClick={() => setModalDataInfoShow(true)}>
                  <MdInfoOutline size={15} />
                </SButton>
              </IconLabel>   
              <DataMenu />
                <DataInfoModel
                  show={modalDataInfoShow}
                  onHide={() => setModalDataInfoShow(false)}
                /> 
            </Content>

          </Container>
    </Fragment>

  );
};

export default ForecastMenu;