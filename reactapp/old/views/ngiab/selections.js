

import {Suspense,lazy} from 'react';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import {TimeSeriesContainer} from 'features/DataStream/old/components/styles';

const CatchmentSelectComponent = lazy(() => import('../../../../hydroFabric/components/catchmentsSelect'));
const NexusSelectComponent = lazy(() => import('../../../../hydroFabric/components/nexusSelect'));
const TrouteSelectComponent = lazy(() => import('../../../../hydroFabric/components/trouteSelect'));
const TeehrSelectComponent = lazy(() => import('../../../../hydroFabric/components/teehrSelect'));


const SelectionView = (props) => {
  return (
        <TimeSeriesContainer singleRowOn={props.singleRowOn}>
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
      </TimeSeriesContainer>
    
  );
};

export default SelectionView;