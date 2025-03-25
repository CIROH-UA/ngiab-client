

import {useEffect,Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
import { mode } from 'd3-array';

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
      actions.set_series(response.data);
      actions.set_chart_layout(response.layout);
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      props.setIsLoading(false);
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
            <label>Troute Variable</label>
            <SelectComponent 
              optionsList={state.troute.variable_list} 
              onChangeHandler={actions.set_troute_variable}
            />
          </Fragment>
        }
    </Fragment>
  );
};

export default TRouteSelect;