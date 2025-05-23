import React, { useReducer } from 'react';
import { modelRunsReducer, modelRunsInitialStore } from '../store/reducers/modelRunsReducer';
import { modelRunActionsTypes } from '../store/actions/actionsTypes';


const useModelRuns = () => {
    const [state, dispatch] = useReducer(modelRunsReducer, modelRunsInitialStore);
    const actions = {
        set_model_run_list: (model_run_list) => dispatch({ type: modelRunActionsTypes.set_model_run_list, payload: model_run_list }),
        set_current_model_runs: (current_model_runs_list) => dispatch({ type: modelRunActionsTypes.set_current_model_runs, payload: current_model_runs_list }),
        set_base_model_id: (base_model_id) => dispatch({ type: modelRunActionsTypes.set_base_model_id, payload: base_model_id }),
        reset: () => dispatch({ type: modelRunActionsTypes.reset }),
    };
    return { state, actions };
}

export { useModelRuns };