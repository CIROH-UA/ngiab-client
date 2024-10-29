

import {useEffect,Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';

// const SelectComponent = lazy(() => import('../../features/hydroFabric/components/selectComponent'));

const TRouteSelect = (props) => {
  const {state,actions} = useHydroFabricContext();


  useEffect(() => {
    if (!state.troute.id) return;
    props.setIsLoading(true);
    var params = {
      troute_id: state.troute.id
    }
    appAPI.getTrouteVariables(params).then((response) => {
      actions.set_troute_variable_list(response.troute_variables);
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
      troute_variable: state.troute.variable
    }
    appAPI.getTrouteTimeSeries(params).then((response) => {
      actions.set_troute_series(response.data);
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
            <h5>Troute</h5>
            <label>Current Variable</label>
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