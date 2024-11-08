import React, { useReducer } from 'react';
import { hydroFabricReducer, hydroFabricInitialStore } from '../store/reducers/hydroFabricReducer';
import { hydroFabricActionsTypes } from '../store/actions/actionsTypes';


const useHydroFabric = () => {
    const [state, dispatch] = useReducer(hydroFabricReducer, hydroFabricInitialStore);
    const actions = {
        set_nexus_id: (id) => dispatch({ type: hydroFabricActionsTypes.set_nexus_id, payload: id }),
        set_nexus_series: (series) => dispatch({ type: hydroFabricActionsTypes.set_nexus_series, payload: series }),
        reset_nexus_series: () => dispatch({ type: hydroFabricActionsTypes.reset_nexus_series }),
        set_catchment_series: (series) => dispatch({ type: hydroFabricActionsTypes.set_catchment_series, payload: series }),
        set_catchment_id: (id) => dispatch({ type: hydroFabricActionsTypes.set_catchment_id, payload: id }),
        set_catchment_variable: (variable) => dispatch({ type: hydroFabricActionsTypes.set_catchment_variable, payload: variable }),
        reset_catchment_series: () => dispatch({ type: hydroFabricActionsTypes.reset_catchment_series }),
        set_nexus_list: (list) => dispatch({ type: hydroFabricActionsTypes.set_nexus_list, payload: list}),
        set_catchment_list: (list) => dispatch({ type: hydroFabricActionsTypes.set_catchment_list, payload: list}),
        set_catchment_variable_list: (list) => dispatch({ type: hydroFabricActionsTypes.set_catchment_variable_list, payload: list}),
        set_troute_series: (series) => dispatch({ type: hydroFabricActionsTypes.set_troute_series, payload: series }),
        set_troute_id: (id) => dispatch({ type: hydroFabricActionsTypes.set_troute_id, payload: id }),
        set_troute_variable: (variable) => dispatch({ type: hydroFabricActionsTypes.set_troute_variable, payload: variable }),
        set_troute_variable_list: (list) => dispatch({ type: hydroFabricActionsTypes.set_troute_variable_list, payload: list }),
        set_teehr_series: (series) => dispatch({ type: hydroFabricActionsTypes.set_teehr_series, payload: series }),
        set_teehr_id: (id) => dispatch({ type: hydroFabricActionsTypes.set_teehr_id, payload: id }),
        set_teehr_variable: (variable) => dispatch({ type: hydroFabricActionsTypes.set_teehr_variable, payload: variable }),
        set_teehr_variable_list: (list) => dispatch({ type: hydroFabricActionsTypes.set_teehr_variable_list, payload: list }),
        reset_teehr: () => dispatch({ type: hydroFabricActionsTypes.reset_teehr }),
        reset_troute: () => dispatch({ type: hydroFabricActionsTypes.reset_troute }),
        reset_nexus: () => dispatch({ type: hydroFabricActionsTypes.reset_nexus }),
        reset_catchment: () => dispatch({ type: hydroFabricActionsTypes.reset_catchment }),
        reset: () => dispatch({ type: hydroFabricActionsTypes.reset }),
        set_series: (series) => dispatch({ type: hydroFabricActionsTypes.set_series, payload: series }),
    };
    return { state, actions };
}

export { useHydroFabric };