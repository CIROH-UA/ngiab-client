

import {Suspense,lazy} from 'react';
import LoadingAnimation from 'components/loader/LoadingAnimation';

import CatchmentSelect from 'old/features/hydroFabric/components/catchmentsSelect';
import NexusSelect from 'old/features/hydroFabric/components/nexusSelect';
import TrouteSelect from 'old/features/hydroFabric/components/trouteSelect';
import TeehrSelect from 'old/features/hydroFabric/components/teehrSelect';
import styled from 'styled-components';
import useTheme from 'hooks/useTheme'; // Adjust the import path as needed

const StyledTimeSeriesContainer = styled.div`
    display: ${props => props.singleRowOn ? 'none' : 'block'};
    margin-top: 1rem;
    width: 100%;
    border-radius: 0.5rem;
`;

const TimeSeriesContainer = (props) => {
  const theme = useTheme();
  return <StyledTimeSeriesContainer {...props} theme={theme} />;
};


const TimeSeriesSelection = ({
    singleRowOn,
    toggleSingleRow,
    setIsLoading
}) => {
  return (
        <TimeSeriesContainer singleRowOn={singleRowOn}>
            <h5>HydroFabric Menu</h5>
            <Suspense fallback={<LoadingAnimation />}>
                <CatchmentSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    singleRowOn={singleRowOn} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>

            <Suspense fallback={<LoadingAnimation />}>
                <NexusSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    singleRowOn={singleRowOn} 
                    setIsLoading={setIsLoading} 
              />
            </Suspense>

            <Suspense fallback={<LoadingAnimation />}>
                <TrouteSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    singleRowOn={singleRowOn} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>
            <Suspense fallback={<LoadingAnimation />}>
                <TeehrSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    singleRowOn={singleRowOn} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>
      </TimeSeriesContainer>
    
  );
};

export default TimeSeriesSelection;