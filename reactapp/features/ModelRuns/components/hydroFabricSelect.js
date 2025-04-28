

import {Suspense,lazy} from 'react';
import LoadingAnimation from 'components/loader/LoadingAnimation';

import CatchmentSelect from 'features/hydroFabric/components/catchmentsSelect';
import NexusSelect from 'features/hydroFabric/components/nexusSelect';
import TrouteSelect from 'features/hydroFabric/components/trouteSelect';
import TeehrSelect from 'features/hydroFabric/components/teehrSelect';
import styled from 'styled-components';
import useTheme from 'hooks/useTheme'; // Adjust the import path as needed

const StyledContainer = styled.div`
    display: ${props => props.isOpen ? 'none' : 'block'};
    margin-top: 1rem;
    width: 100%;
    border-radius: 0.5rem;
`;

const Container = (props) => {
  const theme = useTheme();
  return <StyledContainer {...props} theme={theme} />;
};


const HydroFabricSelect = ({
    isOpen,
    toggleSingleRow,
    setIsLoading
}) => {
  return (
        <Container isOpen={isOpen}>
            <h5>HydroFabric Menu</h5>
            <Suspense fallback={<LoadingAnimation />}>
                <CatchmentSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    singleRowOn={isOpen} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>

            <Suspense fallback={<LoadingAnimation />}>
                <NexusSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    singleRowOn={isOpen} 
                    setIsLoading={setIsLoading} 
              />
            </Suspense>

            <Suspense fallback={<LoadingAnimation />}>
                <TrouteSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    singleRowOn={isOpen} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>
            <Suspense fallback={<LoadingAnimation />}>
                <TeehrSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    singleRowOn={isOpen} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>
      </Container>
    
  );
};

export default HydroFabricSelect;