import { modelRunActionsTypes } from '../actions/actionsTypes';

const modelRunsInitialStore = {
    state:{
        model_runs: [],
        current_model_runs: []
    },
    actions:{}
};


const modelRunsReducer = (state, action) => {
    switch (action.type) {
        case modelRunActionsTypes.set_model_run_list:
            return {
                ...state,
                state: {
                    ...state.state,
                    model_runs: action.payload
                }
            };
        case modelRunActionsTypes.set_current_model_runs:
            return {
                ...state,
                state: {
                    ...state.state,
                    current_model_runs: action.payload
                }
            }; 
        case modelRunActionsTypes.reset:
            return modelRunsInitialStore;
        default:
            return state;
    }
}

export { modelRunsInitialStore, modelRunsReducer }