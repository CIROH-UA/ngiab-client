import React, { useReducer } from 'react';
import { dataStreamModelRunsInitialStore, dataStreamModelRunsReducer } from '../store/reducers/dataStreamModelRunsReducer';

import { dataStreamModelRunActionsTypes } from '../store/actions/actionsTypes';


const useDataStreamModelRuns = () => {
    const [state, dispatch] = useReducer(dataStreamModelRunsReducer, dataStreamModelRunsInitialStore);
    const actions = {
        set_model_run_list: (datastream_model_run_list) => dispatch({ type: dataStreamModelRunActionsTypes.set_datastream_model_list, payload: datastream_model_run_list }),
        set_current_model_runs: (datastream_current_model_runs_list) => dispatch({ type: dataStreamModelRunActionsTypes.set_current_datastream_model_runs, payload: datastream_current_model_runs_list }),
        set_base_model_id: (datastream_base_model_id) => dispatch({ type: dataStreamModelRunActionsTypes.set_datastream_base_model_id, payload: datastream_base_model_id }),
        reset: () => dispatch({ type: dataStreamModelRunActionsTypes.reset }),
    };
    return { state, actions };
}

export { useDataStreamModelRuns };