

import {useEffect, Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
// const SelectComponent = lazy(() => import('selectComponent'));

const NexusSelect = (props) => {
  const {state,actions} = useHydroFabricContext();

  useEffect(() => {
    if (!state.nexus.id) return;
    actions.reset_catchment();
    var params = {
      nexus_id: state.nexus.id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      actions.set_series(response.data);
      actions.set_nexus_list(response.nexus_ids);
      actions.set_troute_id(state.nexus.id);
      props.toggleSingleRow(false);
    }).catch((error) => {
      console.log("Error fetching nexus time series", error);
    })
    return  () => {
      if(state.nexus.id) return
      actions.reset_nexus();
    }

  }, [state.nexus.id]);


  return (
    <Fragment>
        {state.nexus.id &&
            <Fragment>
                <h5>Time Series Menu</h5>
                <label>Nexus ID</label>
                <SelectComponent 
                optionsList={state.nexus.list} 
                onChangeHandler={actions.set_nexus_id}
                defaultValue={
                    {
                    'value': state.nexus.id,
                    'label': state.nexus.id
                    }
                }
                />
            </Fragment>
        }
    </Fragment>
  );
};

export default NexusSelect;