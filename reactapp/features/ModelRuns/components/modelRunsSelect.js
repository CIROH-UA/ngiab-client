

import {useEffect, useState, Fragment,lazy} from 'react';
import { useModelRunsContext } from 'features/hydroFabric/hooks/useModelRunsContext';
import appAPI from 'services/api/app';

import SelectComponent from './selectComponent';

const ModelRunsSelect = (props) => {
  const {state,actions} = useModelRunsContext();
  const [modelRunsOptions, setModelRunsOptions] = useState([]);
  useEffect(() => {

    appAPI.getModelRuns().then((response) => {
      console.log("Model Runs", response.data);
      actions.set_model_run_list(response.data);
      setModelRunsOptions(response
        .data
        .map((model_run) => {
          return {
            value: model_run.id,
            label: model_run.label
          }
        })
      );

    }).catch((error) => {
      console.log("Error fetching Model Runs", error);
    })
    return  () => {
      if(state.model_runs.length < 1) return
      actions.reset();
    }

  }, [state.model_runs]);


  return (
    <Fragment>
        {state.model_runs &&
            <Fragment>
                <h5>Model Runs</h5>
                <SelectComponent 
                  optionsList={modelRunsOptions} 
                  // onChangeHandler={actions.model_runs_select}
                  defaultValue={
                      {
                      'value': actions.model_runs_select[0].value,
                      'label': actions.model_runs_select[0].label
                      }
                  }
                />
            </Fragment>
        }
    </Fragment>
  );
};

export default ModelRunsSelect;