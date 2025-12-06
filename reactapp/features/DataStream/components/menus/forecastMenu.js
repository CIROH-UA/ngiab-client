import React, { Fragment, useState, useMemo } from 'react';
import DataMenu from '../dataDialog';
import { MdSsidChart,MdInfoOutline } from "react-icons/md";
import { IconLabel, Title, Container, SButton } from '../styles/styles';
import { Content } from '../styles/styles';
import { DataInfoModel } from '../modals';
import TimeSeriesCard from '../../views/TimeseriesCard';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';
import { ChartHeader } from 'features/DataStream/components/CharHeader';

const ForecastMenu = () => {
  const [ modalDataInfoShow, setModalDataInfoShow ] = useState(false);
  const feature_id = useTimeSeriesStore((state) => state.feature_id);
  const layout = useTimeSeriesStore((state) => state.layout);

  const isopen = useMemo(() => {
    return feature_id ? true : false;
  }, [feature_id]);
  const set_feature_id = useTimeSeriesStore((state) => state.set_feature_id);

  return (
    <Fragment>
          
          <Container $isOpen={isopen}>
            <div>
                  {layout?.title && (
                    <ChartHeader
                      title ={layout.title}
                      onClick={()=> {set_feature_id(null)}} 
                    />
                  )}
            </div>
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