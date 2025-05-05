

import {Suspense, useEffect, useState} from 'react';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import CatchmentSelect from 'features/hydroFabric/components/catchmentsSelect';
import NexusSelect from 'features/hydroFabric/components/nexusSelect';
import TrouteSelect from 'features/hydroFabric/components/trouteSelect';
import TeehrSelect from 'features/hydroFabric/components/teehrSelect';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import styled from 'styled-components';
import useTheme from 'hooks/useTheme'; // Adjust the import path as needed

const StyledContainer = styled.div`
    display: block;
    margin-top: 1rem;
    width: 100%;
    border-radius: 0.5rem;
`;

const Container = (props) => {
  const theme = useTheme();
  return <StyledContainer {...props} theme={theme} />;
};


const HydroFabricSelect = ({
    
    toggleSingleRow,
    setIsLoading
}) => {
  const {state,actions} = useHydroFabricContext();
  const [promptMessage, setPromptMessage] = useState(null);
  useEffect(() => {
    console.log("HydroFabricSelect: ", state);
    if (!state.nexus.id){
        setPromptMessage("Please select a catchment, nexus, troute or teehr to view time series data.");
    }
  }
  , []);
    useEffect(() => {
        if (!promptMessage) return;
    }
    , [promptMessage]);
    
  
  return (
        <Container>
            <h5>HydroFabric Menu</h5>
            {
                promptMessage && (
                    <div style={{color: "white", fontSize: "1rem", marginBottom: "1rem", fontWeight: "bold"}}>
                        {promptMessage}
                    </div>
                )
            }
            <Suspense fallback={<LoadingAnimation />}>
                <CatchmentSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>

            <Suspense fallback={<LoadingAnimation />}>
                <NexusSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    setIsLoading={setIsLoading} 
              />
            </Suspense>

            <Suspense fallback={<LoadingAnimation />}>
                <TrouteSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>
            <Suspense fallback={<LoadingAnimation />}>
                <TeehrSelect 
                    toggleSingleRow = {toggleSingleRow} 
                    setIsLoading={setIsLoading} 
                />
            </Suspense>
      </Container>
    
  );
};

export default HydroFabricSelect;