

import {useEffect, Fragment} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';

import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
import styled from 'styled-components';

const StyledLabel = styled.label`
  color: #ffffff !important;
  font-weight: 500;
  font-size: 0.9rem;
  margin-bottom: 6px;
  display: block;
  letter-spacing: 0.3px;
  
  /* Reduce font size for smaller screens */
  @media (max-width: 1366px) {
    font-size: 0.85rem;
    margin-bottom: 5px;
  }
  
  @media (max-width: 1024px) {
    font-size: 0.8rem;
    margin-bottom: 4px;
  }
`;

const SelectContainer = styled.div`
  margin-bottom: 12px;
  
  /* Reduce margin for smaller screens */
  @media (max-width: 1366px) {
    margin-bottom: 10px;
  }
  
  @media (max-width: 1024px) {
    margin-bottom: 8px;
  }
`;

const TeehrSelect = (props) => {
  const {state,actions} = useHydroFabricContext();
  const {state: modelRunsState} = useModelRunsContext();
  useEffect(() => {
    
    if (!state.teehr.id) {
      console.log("No teehr id set, skipping API call");
      return;
    }
    else {
      console.log("Fetching teehr variables for ID:", state.teehr.variable_list);
    }
    var params = {
      model_run_id: modelRunsState.base_model_id
    }   
    appAPI.getTeehrVariables(params).then((response) => {
      actions.set_teehr_variable_list(response.teehr_variables);
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    
    }).catch((error) => {
      props.setIsLoading(false);
      console.log("Error fetching teehr variables", error);
    })
    return  () => {
      if (state.teehr.id) return;
      actions.reset_teehr();
    }
  },[state.teehr.id]);

  useEffect(() => {
    console.log("Teehr variable changed:", state.teehr.variable);
    if (!state.teehr.variable || !state.teehr.id) return;
    props.setIsLoading(true);
    var params = {
      teehr_id: state.teehr.id,
      teehr_variable: state.teehr.variable,
      model_run_id: modelRunsState.base_model_id
    }
    appAPI.getTeehrTimeSeries(params).then((response) => {
      actions.set_teehr_series(response.data);
      actions.set_teehr_chart_layout(response.layout);
      // actions.set_series(response.data);
      // actions.set_chart_layout(response.layout);
      actions.set_teehr_metrics(response.metrics)
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      props.setIsLoading(false);
      console.log("Error fetching teehr time series", error);
    })
    return  () => {
      if (state.teehr.id) return;
      actions.reset_teehr();
    }
  },[state.teehr.variable]);

  return (
    <Fragment>
        {
          state.teehr.id &&
          <Fragment>
            <SelectContainer>
              <StyledLabel>TEEHR</StyledLabel>
              <SelectComponent 
                optionsList={state.teehr.variable_list} 
                onChangeHandler={actions.set_teehr_variable}
              />
            </SelectContainer>
          </Fragment>
        }
    </Fragment>
  );
};

export default TeehrSelect;