

import {useEffect, Suspense, Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import { SelectContainer,HydroFabricPlotContainer } from './containers';
import LoadingAnimation from 'components/loader/LoadingAnimation';


const HydroFabricLinePlot = lazy(() => import('../../features/hydroFabric/components/hydroFabricLinePlot'));
const CatchmentSelectComponent = lazy(() => import('../../features/hydroFabric/components/catchmentsSelect'));
const NexusSelectComponent = lazy(() => import('../../features/hydroFabric/components/nexusSelect'));
const TrouteSelectComponent = lazy(() => import('../../features/hydroFabric/components/trouteSelect'));

const HydroFabricView = (props) => {
  const {state,actions} = useHydroFabricContext();

  return (
    <Fragment>
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
            
      </SelectContainer>

      <Suspense fallback={<LoadingAnimation />}>
       <HydroFabricPlotContainer>
          <HydroFabricLinePlot singleRowOn={props.singleRowOn}/> 
        </HydroFabricPlotContainer> 
      </Suspense>

    </Fragment>



  );
};

export default HydroFabricView;