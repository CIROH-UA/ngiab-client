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
            list:null,
            variable_list:null
        },
        troute:{
            series:null,
            variable:null,
            id:null,
            list:null,
            variable_list:null
        },
        teehr:{
            series:null,
            id:null,
            list:null,
            variable:null,
            variable_list:null
        }

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
                        series: null
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
        case hydroFabricActionsTypes.set_catchment_variable_list:
            return {
                ...state,
                state: {
                    ...state.state,
                    catchment: {
                        ...state.state.catchment,
                        variable_list: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.set_troute_series:
            return {
                ...state,
                state: {
                    ...state.state,
                    troute: {
                        ...state.state.troute,
                        series: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.set_troute_id:
            return {
                ...state,
                state: {
                    ...state.state,
                    troute: {
                        ...state.state.troute,
                        id: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.set_troute_variable:
            return {
                ...state,
                state: {
                    ...state.state,
                    troute: {
                        ...state.state.troute,
                        variable: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.set_troute_variable_list:
            return {
                ...state,
                state: {
                    ...state.state,
                    troute: {
                        ...state.state.troute,
                        variable_list: action.payload
                    }
                }
            };

        case hydroFabricActionsTypes.set_teehr_series:
            return {
                ...state,
                state: {
                    ...state.state,
                    teehr: {
                        ...state.state.teehr,
                        series: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.set_teehr_id:
            return {
                ...state,
                state: {
                    ...state.state,
                    teehr: {
                        ...state.state.teehr,
                        id: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.set_teehr_variable:
            return {
                ...state,
                state: {
                    ...state.state,
                    teehr: {
                        ...state.state.teehr,
                        variable: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.set_teehr_variable_list:
            return {
                ...state,
                state: {
                    ...state.state,
                    teehr: {
                        ...state.state.teehr,
                        variable_list: action.payload
                    }
                }
            };
        case hydroFabricActionsTypes.reset_teehr:
            return {
                ...state,
                state: {
                    ...state.state,
                    teehr: {
                        series:null,
                        variable:null,
                        id:null,
                        list:null,
                        variable_list:null
                    }
                }
            };
        case hydroFabricActionsTypes.reset_troute:
            return {
                ...state,
                state: {
                    ...state.state,
                    troute: {
                        series:null,
                        variable:null,
                        id:null,
                        list:null,
                        variable_list:null
                    }
                }
            };
        case hydroFabricActionsTypes.reset_nexus:
            return {
                ...state,
                state: {
                    ...state.state,
                    nexus: {
                        series:null,
                        id:null,
                        list:null
                    }
                }
            };
        case hydroFabricActionsTypes.reset_catchment:
            return {
                ...state,
                state: {
                    ...state.state,
                    catchment: {
                        series:null,
                        variable:null,
                        id:null,
                        list:null,
                        variable_list:null
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