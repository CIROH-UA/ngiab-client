import React, { Fragment, useState, useMemo } from 'react';
import DataMenu from '../dataDialog';
import { MdSsidChart,MdInfoOutline, MdClose } from "react-icons/md";
import { IconLabel, Title, Container, ToggleButton, SButton } from '../styles/styles';
import { Content } from '../styles/styles';
import { DataInfoModel } from '../modals';
import TimeSeriesCard from '../../views/TimeseriesCard';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';

const ForecastMenu = () => {
  const [ modalDataInfoShow, setModalDataInfoShow ] = useState(false);
  const feature_id = useTimeSeriesStore((state) => state.feature_id);

  const isopen = useMemo(() => {
    console.log('feature_id', feature_id ? 'true' : 'false');
    return feature_id ? true : false;
  }, [feature_id]);

  return (
    <Fragment>
          
          {
            isopen ?
              <ToggleButton onClick={()=> {!isopen}} $top={80} >
                <MdClose size={15} />
              </ToggleButton> 
            : null
          }

          <Container $isOpen={isopen}>

            <Content>

              <TimeSeriesCard />
            </Content>
            <Content>
              <IconLabel>
                <MdSsidChart />
                <Title>
                  Data Options
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