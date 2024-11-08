

import {Suspense, Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { SelectContainer,HydroFabricPlotContainer,TeehrMetricsWrapper } from './containers';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import ParentSize from '@visx/responsive/lib/components/ParentSize';



// const HydroFabricLinePlot = lazy(() => import('../../features/hydroFabric/components/hydroFabricLinePlot'));
const CatchmentSelectComponent = lazy(() => import('../../features/hydroFabric/components/catchmentsSelect'));
const NexusSelectComponent = lazy(() => import('../../features/hydroFabric/components/nexusSelect'));
const TrouteSelectComponent = lazy(() => import('../../features/hydroFabric/components/trouteSelect'));
const TeehrSelectComponent = lazy(() => import('../../features/hydroFabric/components/teehrSelect'));
const LineChart = lazy(() => import('../../features/hydroFabric/components/chart'));
const  TeehrMetricsTable = lazy(() => import('../../features/hydroFabric/components/teehrMetrics'));

const HydroFabricView = (props) => {
  const {state,actions} = useHydroFabricContext();
  return (
    <Fragment>
        {
            state.teehr.metrics &&
            <TeehrMetricsWrapper>
                <TeehrMetricsTable data={state.teehr.metrics} />
            </TeehrMetricsWrapper>
        }

        <SelectContainer>
            <Suspense fallback={<LoadingAnimation />}>
                <CatchmentSelectComponent 
                    toggleSingleRow = {props.toggleSingleRow} 
                    singleRowOn={props.singleRowOn} 
                    setIsLoading={props.setIsLoading} 
                />
            </Suspense>

            <Suspense fallback={<LoadingAnimation />}>
                <NexusSelectComponent 
                    toggleSingleRow = {props.toggleSingleRow} 
                    singleRowOn={props.singleRowOn} 
                    setIsLoading={props.setIsLoading} 
              />
            </Suspense>

            <Suspense fallback={<LoadingAnimation />}>
                <TrouteSelectComponent 
                    toggleSingleRow = {props.toggleSingleRow} 
                    singleRowOn={props.singleRowOn} 
                    setIsLoading={props.setIsLoading} 
                />
            </Suspense>
            <Suspense fallback={<LoadingAnimation />}>
                <TeehrSelectComponent 
                    toggleSingleRow = {props.toggleSingleRow} 
                    singleRowOn={props.singleRowOn} 
                    setIsLoading={props.setIsLoading} 
                />
            </Suspense>
      </SelectContainer>

      <Suspense fallback={<LoadingAnimation />}>
       <HydroFabricPlotContainer>
          {/* <HydroFabricLinePlot singleRowOn={props.singleRowOn}/>  */}
          <ParentSize>
      {({ width, height }) => 
    <LineChart width={width} height={height} data={state.chart.series}/>}</ParentSize>

        </HydroFabricPlotContainer> 
      </Suspense>

    </Fragment>



  );
};

export default HydroFabricView;