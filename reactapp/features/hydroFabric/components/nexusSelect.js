

import {useEffect, Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';

const NexusSelect = (props) => {
  const {state,actions} = useHydroFabricContext();
  console.log("NexusSelect context nexus:", state.nexus);

  const {state: modelRunsState} = useModelRunsContext();

  useEffect(() => {
    console.log("NexusSelect", state.nexus.id)
    if (!state.nexus.id) return;
    actions.reset_catchment();
    var params = {
      nexus_id: state.nexus.id,
      model_run_id: modelRunsState.base_model_id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      actions.set_series(response.data);
      actions.set_chart_layout(response.layout);
      if(response.usgs_id){
        actions.set_teehr_id(response.usgs_id);
      }
      else{
        actions.reset_teehr();
      }
      
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