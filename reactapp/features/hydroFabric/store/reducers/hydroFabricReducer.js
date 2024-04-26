import { hydroFabricActionsTypes } from '../actions/actionsTypes';

const hydroFabricInitialStore = {
    state:{
        nexus:
        {
            series:[],
            id:null,
        },
        catchment:{
            series:[],
            variable:null,
            id:null,
        },

    },
    actions:{}
};



const hydroFabricReducer = (state, action) => {
    switch (action.type) {
        case hydroFabricSeriesActionsTypes.set_nexus_id:
            return {
                ...state,
                state: {
                    ...state.state,
                    nexus: {
                        ...state.state.nexus,
                        id: action.payload
                    }
                }
            };
        case hydroFabricSeriesActionsTypes.set_nexus_series:
            return {
                ...state,
                state: {
                    ...state.state,
                    nexus: {
                        ...state.state.nexus,
                        series: action.payload
                    }
                }
            };
        case hydroFabricSeriesActionsTypes.reset_nexus_series:
            return {
                ...state,
                state: {
                    ...state.state,
                    nexus: {
                        ...state.state.nexus,
                        series: []
                    }
                }
            };
        case hydroFabricSeriesActionsTypes.set_catchment_series:
            return {
                ...state,
                state: {
                    ...state.state,
                    catchment: {
                        ...state.state.catchment,
                        series: action.payload
                    }
                }
            };
        case hydroFabricSeriesActionsTypes.set_catchment_id:
            return {
                ...state,
                state: {
                    ...state.state,
                    catchment: {
                        ...state.state.catchment,
                        id: action.payload
                    }
                }
            };
        case hydroFabricSeriesActionsTypes.set_catchment_variable:
            return {
                ...state,
                state: {
                    ...state.state,
                    catchment: {
                        ...state.state.catchment,
                        variable: action.payload
                    }
                }
            };
        case hydroFabricSeriesActionsTypes.reset:
            return hydroFabricInitialStore;
        default:
            return state;
    }
}
export { hydroFabricInitialStore, hydroFabricReducer }