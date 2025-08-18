

import {Suspense,lazy} from 'react';
import LoadingAnimation from 'components/loader/LoadingAnimation';

import CatchmentSelect from 'features/hydroFabric/components/catchmentsSelect';
import NexusSelect from 'features/hydroFabric/components/nexusSelect';
import TrouteSelect from 'features/hydroFabric/components/trouteSelect';
import TeehrSelect from 'features/hydroFabric/components/teehrSelect';
import styled from 'styled-components';
import useTheme from 'hooks/useTheme'; // Adjust the import path as needed

const StyledTimeSeriesContainer = styled.div`
    display: ${props => props.singleRowOn ? 'none' : 'block'};
    margin-top: 1rem;
    width: 100%;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 15px;
    margin-bottom: 15px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(5px);
    
    /* Reduce padding for smaller screens */
    @media (max-width: 1366px) {
      padding: 12px;
      margin-bottom: 12px;
    }
    
    @media (max-width: 1024px) {
      padding: 10px;
      margin-bottom: 10px;
    }
`;

const TimeSeriesContainer = (props) => {
  const theme = useTheme();
  return <StyledTimeSeriesContainer {...props} theme={theme} />;
};

const HydrofabricTitle = styled.h5`
  color: #ffffff !important;
  font-weight: 500;
  font-size: 1rem;
  margin-bottom: 15px;
  text-align: center;
  letter-spacing: 0.5px;
  position: relative;
  
  /* Reduce font size for smaller screens */
  @media (max-width: 1366px) {
    font-size: 0.9rem;
    margin-bottom: 12px;
  }
  
  @media (max-width: 1024px) {
    font-size: 0.85rem;
    margin-bottom: 10px;
  }
  
  &::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 2px;
    background: linear-gradient(135deg, #ffffff 0%, #cafeff 100%);
    border-radius: 1px;
  }
`;

const TimeSeriesSelection = ({
    singleRowOn,
    toggleSingleRow,
    setIsLoading
}) => {
  return (
        <TimeSeriesContainer singleRowOn={singleRowOn}>
            <HydrofabricTitle>HydroFabric Menu</HydrofabricTitle>
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