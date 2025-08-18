

import {useEffect,Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
import { toast } from 'react-toastify';
import { mode } from 'd3-array';
import styled from 'styled-components';

const StyledLabel = styled.label`
  color: #ffffff !important;
  font-weight: 500;
  font-size: 0.95rem;
  margin-bottom: 8px;
  display: block;
  letter-spacing: 0.3px;
`;

const SelectContainer = styled.div`
  margin-bottom: 15px;
`;

const TRouteSelect = (props) => {
  const {state,actions} = useHydroFabricContext();
  const {state: modelRunsState} = useModelRunsContext();

  useEffect(() => {
    if (!state.troute.id) return;
    props.setIsLoading(true);
    var params = {
      troute_id: state.troute.id,
      model_run_id: modelRunsState.base_model_id
    }
    appAPI.getTrouteVariables(params).then((response) => {
      if (response.troute_variables.length === 0){
        actions.set_troute_id(null);
      }
      else{
        actions.set_troute_variable_list(response.troute_variables);
      }
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      props.setIsLoading(false);
      console.log("Error fetching troute variables", error);
    })
    return  () => {
      if (state.troute.id) return;
      actions.reset_troute();
    }
  },[state.troute.id]);


  useEffect(() => {
    if (!state.troute.variable || !state.troute.id) return;
    props.setIsLoading(true);
    var params = {
      troute_id: state.troute.id,
      troute_variable: state.troute.variable,
      model_run_id: modelRunsState.base_model_id
    }
    appAPI.getTrouteTimeSeries(params).then((response) => {
      if (response.data.length === 0) {
       toast.info("No data available for this troute and model run", { autoClose: 1000 });
      }
      actions.set_troute_series(response.data);
      actions.set_troute_chart_layout(response.layout);
      // actions.set_series(response.data);
      // actions.set_chart_layout(response.layout);
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      props.setIsLoading(false);
      toast.error("Error fetching troute time series", { autoClose: 1000 });
      console.log("Error fetching troute time series", error);
    })
    return  () => {
      if (state.troute.id) return;
      actions.reset_troute();
    }
  },[state.troute.variable]);


  return (
    <Fragment>
        {
          state.troute.id &&
          <Fragment>
            <SelectContainer>
              <StyledLabel>Troute Variable</StyledLabel>
              <SelectComponent 
                optionsList={state.troute.variable_list} 
                onChangeHandler={actions.set_troute_variable}
              />
            </SelectContainer>
          </Fragment>
        }
    </Fragment>
  );
};

export default TRouteSelect;