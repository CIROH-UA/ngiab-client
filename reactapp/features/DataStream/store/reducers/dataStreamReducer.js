import { dataStreamActionsTypes } from '../actions/actionsTypes';

const dataStreamInitialStore = {
    state:{
        geometry: 'http://localhost:9000/ciroh-community-ngen-datastream/v2.2_resources/VPU_01/config/nexus.pmtiles',
        cache_key: null,
        vpu: null,
        date: null,
        forecast: null,
        time: null,
        cycle: null,
    },
    actions:{}
};


const dataStreamReducer = (state, action) => {
    switch (action.type) {
        case dataStreamActionsTypes.set_cache_key:
            return {
                ...state,
                state: {
                    ...state.state,
                    cache_key: action.payload
                }
            };
        case dataStreamActionsTypes.set_vpu:
            return {
                ...state,
                state: {
                    ...state.state,
                    vpu: action.payload
                }
            };
        case dataStreamActionsTypes.set_date:
            return {
                ...state,
                state: {
                    ...state.state,
                    date: action.payload
                }
            };            
        case dataStreamActionsTypes.set_forecast:
            return {
                ...state,
                state: {
                    ...state.state,
                    forecast: action.payload
                }
            };
        case dataStreamActionsTypes.set_time:
            return {
                ...state,
                state: {
                    ...state.state,
                    time: action.payload
                }
            };
        case dataStreamActionsTypes.set_cycle:
            return {
                ...state,
                state: {
                    ...state.state,
                    cycle: action.payload
                }
            }; 
        case dataStreamActionsTypes.set_geometry:
            return {
                ...state,
                state: {
                    ...state.state,
                    geometry: action.payload
                }
            };
        case dataStreamActionsTypes.reset:
            return dataStreamInitialStore;
        default:
            return state;
    }
}

export { dataStreamInitialStore, dataStreamReducer }