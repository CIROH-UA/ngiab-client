import React, { useReducer } from 'react';
import { modelRunsReducer, modelRunsInitialStore } from '../store/reducers/hydroFabricReducer';
import { modelRunActionsTypes } from '../store/actions/actionsTypes';


const useModelRuns = () => {
    const [state, dispatch] = useReducer(modelRunsReducer, modelRunsInitialStore);
    const actions = {
        set_model_run_list: (model_run_list) => dispatch({ type: modelRunActionsTypes.set_model_run_list, payload: model_run_list }),
        set_current_model_runs: (current_model_runs) => dispatch({ type: modelRunActionsTypes.set_current_model_runs, payload: current_model_runs }),
        reset: () => dispatch({ type: modelRunActionsTypes.reset }),
    };
    return { state, actions };
}

export { useModelRuns };