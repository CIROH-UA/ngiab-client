import { hydroFabricActionsTypes } from '../actions/actionsTypes';

const hydroFabricInitialStore = {
    state:{
        nexus:
        {
            series:null,
            id:null,
            list:null
        },
        catchment:{
            series:null,
            variable:null,
            id:null,
            list:null
        },

    },
    actions:{}
};



const hydroFabricReducer = (state, action) => {
    switch (action.type) {
        case hydroFabricActionsTypes.set_nexus_id:
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
        case hydroFabricActionsTypes.set_nexus_series:
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
        case hydroFabricActionsTypes.reset_nexus_series:
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
        case hydroFabricActionsTypes.set_nexus_list:
            return {
                ...state,
                state: {
                    ...state.state,
                    nexus: {
                        ...state.state.nexus,
                        list: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.set_catchment_series:
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
        
        case hydroFabricActionsTypes.set_catchment_id:
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
        case hydroFabricActionsTypes.set_catchment_variable:
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
        case hydroFabricActionsTypes.set_catchment_list:
            return {
                ...state,
                state: {
                    ...state.state,
                    catchment: {
                        ...state.state.catchment,
                        list: action.payload
                    }
                }
            };
            
        case hydroFabricActionsTypes.reset:
            return hydroFabricInitialStore;
        default:
            return state;
    }
}
export { hydroFabricInitialStore, hydroFabricReducer }