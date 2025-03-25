import {useEffect, useState, Fragment,lazy} from 'react';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import appAPI from 'services/api/app';

import SelectComponent from './selectComponent';



const options = [
  { value: 'chocolate', label: 'Chocolate' },
  { value: 'strawberry', label: 'Strawberry' },
  { value: 'vanilla', label: 'Vanilla' }
]


const ModelRunsSelect = (props) => {
  const {state,actions} = useModelRunsContext();
  
  useEffect(() => {

    appAPI.getModelRuns().then((response) => {

      // console.log("Model Runs", response.model_runs)
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
    console.log("Model Runs", state.current_model_runs)
  }
  , [state.current_model_runs]);


  return (
    <Fragment>
        {state.model_runs.length > 0 &&
            <Fragment>
                <h5>Model Runs</h5>
                
                <SelectComponent 
                  optionsList={state.model_runs} 
                  onChangeHandler={actions.set_current_model_runs}
                  // defaultValue={
                  //     {
                  //     'value': state.model_runs[0].value,
                  //     'label': state.model_runs[0].label
                  //     }
                  // }
                />
            </Fragment>
        }
    </Fragment>
  );
};

export default ModelRunsSelect;