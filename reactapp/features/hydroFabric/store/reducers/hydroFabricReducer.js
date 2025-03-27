import { hydroFabricActionsTypes } from '../actions/actionsTypes';

const hydroFabricInitialStore = {
  state: {
    nexus: {
      id: null,
      list: null,
      geometry:{
        clustered: true,
        hidden: false
      },
      chart: {
        series: [],
        layout: {
          yaxis: null,
          xaxis: null,
          title: null
        }
      }
    },
    catchment: {
      id: null,
      list: null,
      variable: null,
      variable_list: null,
      chart: {
        series: [],
        layout: {
          yaxis: null,
          xaxis: null,
          title: null
        }
      },
      geometry:{
        hidden: false
      },
    },
    troute: {
      id: null,
      list: null,
      variable: null,
      variable_list: null,
      chart: {
        series: [],
        layout: {
          yaxis: null,
          xaxis: null,
          title: null
        }
      }
    },
    teehr: {
      id: null,
      list: null,
      variable: null,
      variable_list: null,
      metrics: null,
      chart: {
        series: [],
        layout: {
          yaxis: null,
          xaxis: null,
          title: null
        }
      }
    }
  },
  actions: {}
};

const hydroFabricReducer = (state, action) => {
  switch (action.type) {

    // -----------------------------
    // NEXUS
    // -----------------------------
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
    case hydroFabricActionsTypes.set_nexus_series:
      return {
        ...state,
        state: {
          ...state.state,
          nexus: {
            ...state.state.nexus,
            chart: {
              ...state.state.nexus.chart,
              series: action.payload
            }
          }
        }
      };
    case hydroFabricActionsTypes.set_nexus_chart_layout:
      return {
        ...state,
        state: {
          ...state.state,
          nexus: {
            ...state.state.nexus,
            chart: {
              ...state.state.nexus.chart,
              layout: action.payload
            }
          }
        }
      };
    case hydroFabricActionsTypes.toggle_nexus_geometry_clusters:
      return {
        ...state,
        state: {
          ...state.state,
          nexus: {
            ...state.state.nexus,
            geometry: {
              ...state.state.nexus.geometry,
              clustered: !state.state.nexus.geometry.clustered
            }
          }
        }
      };
    case hydroFabricActionsTypes.toggle_nexus_geometry_hidden:
      return {
        ...state,
        state: {
          ...state.state,
          nexus: {
            ...state.state.nexus,
            geometry: {
              ...state.state.nexus.geometry,
              hidden: !state.state.nexus.geometry.hidden
            }
          }
        }
      };
    case hydroFabricActionsTypes.reset_nexus:
      return {
        ...state,
        state: {
          ...state.state,
          nexus: {
            id: null,
            list: null,
            chart: {
              series: [],
              layout: {
                yaxis: null,
                xaxis: null,
                title: null
              }
            },
            geometry:{
              clustered: true,
              hidden: false
            }
          }
        }
      };


    // -----------------------------
    // CATCHMENT
    // -----------------------------
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
    case hydroFabricActionsTypes.set_catchment_series:
      return {
        ...state,
        state: {
          ...state.state,
          catchment: {
            ...state.state.catchment,
            chart: {
              ...state.state.catchment.chart,
              series: action.payload
            }
          }
        }
      };
    case hydroFabricActionsTypes.set_catchment_chart_layout:
      return {
        ...state,
        state: {
          ...state.state,
          catchment: {
            ...state.state.catchment,
            chart: {
              ...state.state.catchment.chart,
              layout: action.payload
            }
          }
        }
      };
    case hydroFabricActionsTypes.toggle_catchment_geometry_hidden:
      return {
        ...state,
        state: {
          ...state.state,
          catchment: {
            ...state.state.catchment,
            geometry: {
              ...state.state.catchment.geometry,
              hidden: !state.state.catchment.geometry.hidden
            }
          }
        }
      };

    case hydroFabricActionsTypes.reset_catchment:
      return {
        ...state,
        state: {
          ...state.state,
          catchment: {
            id: null,
            list: null,
            variable: null,
            variable_list: null,
            chart: {
              series: [],
              layout: {
                yaxis: null,
                xaxis: null,
                title: null
              }
            },
            geometry:{
              hidden: false
            },
          }
        }
      };

    // -----------------------------
    // T-ROUTE
    // -----------------------------
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
    case hydroFabricActionsTypes.set_troute_series:
      return {
        ...state,
        state: {
          ...state.state,
          troute: {
            ...state.state.troute,
            chart: {
              ...state.state.troute.chart,
              series: action.payload
            }
          }
        }
      };
    case hydroFabricActionsTypes.set_troute_chart_layout:
      return {
        ...state,
        state: {
          ...state.state,
          troute: {
            ...state.state.troute,
            chart: {
              ...state.state.troute.chart,
              layout: action.payload
            }
          }
        }
      };
    case hydroFabricActionsTypes.reset_troute:
      return {
        ...state,
        state: {
          ...state.state,
          troute: {
            id: null,
            list: null,
            variable: null,
            variable_list: null,
            chart: {
              series: [],
              layout: {
                yaxis: null,
                xaxis: null,
                title: null
              }
            }
          }
        }
      };

    // -----------------------------
    // TEEHR
    // -----------------------------
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
    case hydroFabricActionsTypes.set_teehr_series:
      return {
        ...state,
        state: {
          ...state.state,
          teehr: {
            ...state.state.teehr,
            chart: {
              ...state.state.teehr.chart,
              series: action.payload
            }
          }
        }
      };
    case hydroFabricActionsTypes.set_teehr_chart_layout:
      return {
        ...state,
        state: {
          ...state.state,
          teehr: {
            ...state.state.teehr,
            chart: {
              ...state.state.teehr.chart,
              layout: action.payload
            }
          }
        }
      };
    case hydroFabricActionsTypes.reset_teehr:
      return {
        ...state,
        state: {
          ...state.state,
          teehr: {
            id: null,
            list: null,
            variable: null,
            variable_list: null,
            metrics: null,
            chart: {
              series: [],
              layout: {
                yaxis: null,
                xaxis: null,
                title: null
              }
            }
          }
        }
      };


    case hydroFabricActionsTypes.reset:
      return hydroFabricInitialStore;

    default:
      return state;
  }
};

export { hydroFabricInitialStore, hydroFabricReducer };
