import { dataStreamModelRunActionsTypes } from '../actions/actionsTypes';

const dataStreamModelRunsInitialStore = {
    state:{
        model_runs: [],
        current_model_runs: [],
        base_model_id: null,
    },
    actions:{}
};


const dataStreamModelRunsReducer = (state, action) => {
    switch (action.type) {
        case dataStreamModelRunActionsTypes.set_datastream_model_list:
            return {
                ...state,
                state: {
                    ...state.state,
                    model_runs: action.payload
                }
            };
        case dataStreamModelRunActionsTypes.set_current_datastream_model_runs:
            return {
                ...state,
                state: {
                    ...state.state,
                    current_model_runs: action.payload
                }
            };
        case dataStreamModelRunActionsTypes.set_datastream_base_model_id:
            return {
                ...state,
                state: {
                    ...state.state,
                    base_model_id: action.payload
                }
            }; 
        case dataStreamModelRunActionsTypes.reset:
            return dataStreamModelRunsInitialStore;
        default:
            return state;
    }
}

export { dataStreamModelRunsInitialStore, dataStreamModelRunsReducer }