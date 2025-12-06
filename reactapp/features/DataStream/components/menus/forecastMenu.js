import React, { Fragment, useMemo } from 'react';
import DataMenu from '../dataDialog';
import { Content, Container } from '../styles/styles';
import TimeSeriesCard from '../TimeseriesCard';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';
import { ForecastHeader } from 'features/DataStream/components/ForecastHeader';
import { FeatureInformation } from '../featureInformation';
const ForecastMenu = () => {

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
                    <ForecastHeader
                      title ={layout.title}
                      onClick={()=> {set_feature_id(null)}} 
                    />
                  )}
            </div>
            
            <Content>
              <TimeSeriesCard />
              <DataMenu />
            </Content>
            <Content>
              <FeatureInformation />
            </Content>
          </Container>
    </Fragment>

  );
};

export default ForecastMenu;