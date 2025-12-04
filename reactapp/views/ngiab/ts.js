import { Suspense, useState, useEffect } from 'react';
import styled from 'styled-components';
import { HydroFabricPlotContainer } from '../../components/StyledContainers';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import ParentSize from '@visx/responsive/lib/components/ParentSize';
import LineChart from 'features/DataStream/components/plot';


const ViewContainer = styled.div`
  height: 100%;
  width: 100%;
  display: ${(props) => (props.fullScreen ? 'none' : 'block')};
`;


const TimeSeriesView = ({singleRowOn}) => {
  const series = useTimeSeriesStore((state) => state.series);
  const layout = useTimeSeriesStore((state) => state.layout);

  return (
    <ViewContainer fullScreen={singleRowOn}>

          { 
              <Suspense fallback={<LoadingAnimation />}>
                <HydroFabricPlotContainer>
                  <ParentSize>
                    {({ width, height }) =>
                      (
                        <LineChart
                          width={width}
                          height={height}
                          data={
                            [
                              {
                                label: 'Streamflow',
                                data: series,
                              },
                            ] 
                            }
                          layout={layout}
                        />
                      )
                    }
                  </ParentSize>
                </HydroFabricPlotContainer>:

              </Suspense>
          }

    </ViewContainer>
  );
};

export default TimeSeriesView;
