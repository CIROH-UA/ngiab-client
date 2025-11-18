import { modelRunActionsTypes } from '../actions/actionsTypes';

const modelRunsInitialStore = {
    state:{
        current_geometry: null,
        model_runs: [],
        current_model_runs: [],
        base_model_id: null,
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
        case modelRunActionsTypes.set_base_model_id:
            return {
                ...state,
                state: {
                    ...state.state,
                    base_model_id: action.payload
                }
            };
        case modelRunActionsTypes.set_current_geometry:
            return {
                ...state,
                state: {
                    ...state.state,
                    current_geometry: action.payload
                }
            };            
        case modelRunActionsTypes.reset:
            return modelRunsInitialStore;
        default:
            return state;
    }
}

export { modelRunsInitialStore, modelRunsReducer }