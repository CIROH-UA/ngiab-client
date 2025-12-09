import { Fragment, Suspense } from 'react';
import { TimeSeriesThemedContainer } from '../styles/Styles';
import useTimeSeriesStore from 'features/DataStream/store/Timeseries';
import LoadingAnimation from 'features/Tethys/components/loader/LoadingAnimation';
import ParentSize from '@visx/responsive/lib/components/ParentSize';
import LineChart from 'features/DataStream/components/forecast/Plot';


const TimeSeriesCard = () => {
  const series = useTimeSeriesStore((state) => state.series);
  const variable = useTimeSeriesStore((state) => state.variable);
  const layout = useTimeSeriesStore((state) => state.layout);

  return (
    <Fragment>
          { 
              <Suspense fallback={<LoadingAnimation />}>
                <TimeSeriesThemedContainer>
                  <ParentSize>
                    {({ width, height }) =>
                      (
                        <LineChart
                          width={width}
                          height={height}
                          data={
                            [
                              {
                                label: variable,
                                data: series,
                              },
                            ] 
                            }
                          layout={layout}
                        />
                      )
                    }
                  </ParentSize>
                </TimeSeriesThemedContainer>

              </Suspense>
          }

    </Fragment>
  );
};

export default TimeSeriesCard;
