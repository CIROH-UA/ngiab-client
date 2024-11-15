

import {useEffect, Fragment} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';


const TeehrSelect = (props) => {
  const {state,actions} = useHydroFabricContext();

  useEffect(() => {
    if (!state.teehr.id) return;
    var params = {}   
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
    if (!state.teehr.variable || !state.teehr.id) return;
    props.setIsLoading(true);
    var params = {
      teehr_id: state.teehr.id,
      teehr_variable: state.teehr.variable
    }
    appAPI.getTeehrTimeSeries(params).then((response) => {
      actions.set_series(response.data);
      actions.set_chart_layout(response.layout);
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
            <label>TEEHR</label>
            <SelectComponent 
              optionsList={state.teehr.variable_list} 
              onChangeHandler={actions.set_teehr_variable}
            />
          </Fragment>
        }
    </Fragment>
  );
};

export default TeehrSelect;