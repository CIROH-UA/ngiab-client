import { hydroFabricActionsTypes } from '../actions/actionsTypes';

const hydroFabricInitialStore = {
    state:{
        chart:{
            series:[],
            layout:{
                yaxis: null,
                xaxis:null,
                title:null
            }
        },
        nexus:
        {
            id:null,
            list:null
        },
        catchment:{
            variable:null,
            id:null,
            list:null,
            variable_list:null
        },
        troute:{
            variable:null,
            id:null,
            list:null,
            variable_list:null
        },
        teehr:{
            id:null,
            list:null,
            variable:null,
            variable_list:null,
            metrics: null
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
        case hydroFabricActionsTypes.set_teehr_metrics:
            return {
                ...state,
                state: {
                    ...state.state,
                    teehr: {
                        ...state.state.teehr,
                        metrics: action.payload
                    }
                }
            };
                
        case hydroFabricActionsTypes.reset_teehr:
            return {
                ...state,
                state: {
                    ...state.state,
                    teehr: {
                        series:[],
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
                        series:[],
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
                        series:[],
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
                        series:[],
                        variable:null,
                        id:null,
                        list:null,
                        variable_list:null
                    }
                }
            };
        case hydroFabricActionsTypes.reset:
            return hydroFabricInitialStore;
        case hydroFabricActionsTypes.set_series:
            return {
                ...state,
                state: {
                    ...state.state,
                    chart: {
                        ...state.state.chart,
                        series: action.payload
                    }
                }
            };
        default:
            return state;
    }
}
export { hydroFabricInitialStore, hydroFabricReducer }