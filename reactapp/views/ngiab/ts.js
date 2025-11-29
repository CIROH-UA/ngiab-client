import { Suspense, useState, useEffect } from 'react';
import styled from 'styled-components';
import { HydroFabricPlotContainer } from '../../components/StyledContainers';
import useTimeSeriesStore from 'features/DataStream/store/timeseries';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import ParentSize from '@visx/responsive/lib/components/ParentSize';
import LineChart from 'features/hydroFabric/components/chart';


const ViewContainer = styled.div`
  height: 100%;
  width: 100%;
  display: ${(props) => (props.fullScreen ? 'none' : 'block')};
`;

const HydroFabricView = ({singleRowOn}) => {
  const series = useTimeSeriesStore((state) => state.series);
  const layout = useTimeSeriesStore((state) => state.layout);
  // If available tabs change and current activeKey is no longer available, update it.
  useEffect(() => {
    console.log("Time Series updated:", series);
  }, [series]);

  return (
    <ViewContainer fullScreen={singleRowOn}>

          {series.length > 0 && (
              <Suspense fallback={<LoadingAnimation />}>
                <HydroFabricPlotContainer>
                  <ParentSize>
                    {({ width, height }) =>
                      (
                        <LineChart
                          width={width}
                          height={height}
                          data={series}
                          layout={layout}
                        />
                      )
                    }
                  </ParentSize>
                </HydroFabricPlotContainer>:

              </Suspense>
          )}

    </ViewContainer>
  );
};

export default HydroFabricView;
