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
    };
    return { state, actions };
}

export { useHydroFabric };