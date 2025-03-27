import {useEffect, useState, Fragment,lazy} from 'react';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';


const ModelRunsSelect = (props) => {
  const {state,actions} = useModelRunsContext();
  
  useEffect(() => {

    appAPI.getModelRuns().then((response) => {
      actions.set_model_run_list(response.model_runs);

    }).catch((error) => {
      console.log("Error fetching Model Runs", error);
    })
    return  () => {
      if(state.model_runs.length < 0) return
      actions.reset();
    }

  }, []);
  
  useEffect(() => {
    if (state.current_model_runs.length < 1){
      return
    }
    actions.set_base_model_id(state.current_model_runs[0].value)
  }
  , [state.current_model_runs]);

  


  return (
    <Fragment>
        {state.model_runs.length > 0 &&
            <Fragment>
                {/* <h5>Model Runs</h5> */}
                <SelectComponent 
                  optionsList={state.model_runs} 
                  onChangeHandler={actions.set_current_model_runs}
                />

            </Fragment>
        }
    </Fragment>
  );
};

export default ModelRunsSelect;