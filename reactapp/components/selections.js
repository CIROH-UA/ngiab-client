

import {Suspense,lazy} from 'react';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import styled from "styled-components";



const CatchmentSelectComponent = lazy(() => import('../features/hydroFabric/components/catchmentsSelect'));
const NexusSelectComponent = lazy(() => import('../features/hydroFabric/components/nexusSelect'));
const TrouteSelectComponent = lazy(() => import('../features/hydroFabric/components/trouteSelect'));
const TeehrSelectComponent = lazy(() => import('../features/hydroFabric/components/teehrSelect'));


export const Container = styled.div`
    position: absolute;
    display: ${props => props.singleRowOn ? 'none' : 'block'};
    top: 60px;
    left: 0.5rem;
    padding: 10px;
    background-color: #2c3e50;
    border-bottom: 1px solid #ddd;
    width: 300px;
    border-radius: 0.5rem;  
    color: white;
`;

const SelectionView = (props) => {
  return (
        <Container singleRowOn={props.singleRowOn}>
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
      </Container>
    
  );
};

export default SelectionView;