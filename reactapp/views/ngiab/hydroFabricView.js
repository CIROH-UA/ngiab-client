

import {Suspense, Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { HydroFabricPlotContainer,TeehrMetricsWrapper } from '../../components/StyledContainers';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import ParentSize from '@visx/responsive/lib/components/ParentSize';


const LineChart = lazy(() => import('../../features/hydroFabric/components/chart'));
const  TeehrMetricsTable = lazy(() => import('../../features/hydroFabric/components/teehrMetrics'));
const SelectionView = lazy(() => import('./selections'));


const HydroFabricView = (props) => {
  const {state} = useHydroFabricContext();
  return (

    <Fragment>
        <Suspense fallback={<LoadingAnimation />}>
            {/* <SelectionView
                toggleSingleRow = {props.toggleSingleRow}
                singleRowOn={props.singleRowOn}
                setIsLoading={props.setIsLoading}
            /> */}
        </Suspense>
        {
            state.teehr.metrics &&
            <TeehrMetricsWrapper>
                <TeehrMetricsTable data={state.teehr.metrics} />
            </TeehrMetricsWrapper>
        }

      <Suspense fallback={<LoadingAnimation />}>

       <HydroFabricPlotContainer>
          <ParentSize>
            {({ width, height }) => 
                      state.chart.series &&
                      <LineChart width={width} height={height} data={state.chart.series} layout={state.chart.layout}/>
              }
          </ParentSize>

        </HydroFabricPlotContainer> 
      </Suspense>

    </Fragment>



  );
};

export default HydroFabricView;