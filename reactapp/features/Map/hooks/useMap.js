import React, { useReducer } from 'react';
import { mapReducer, mapInitialStore } from '../store/reducers/mapReducer';
import { MapActionsTypes } from '../store/actions/actionsTypes';


const useMap = () => {
    const [state, dispatch] = useReducer(mapReducer, mapInitialStore);
    const actions = {
        addLayer: (layer) => dispatch({ type: MapActionsTypes.add_layer, payload: layer }),
        removeLayer: (layer) => dispatch({ type: MapActionsTypes.delete_layer, payload: layer }),
        toggle_loading_layers: () => dispatch({ type: MapActionsTypes.toggle_loading_layers }),
        delete_layer_by_name: (name) => dispatch({ type: MapActionsTypes.delete_layer_by_name,payload: name }),
        delete_all_layers: () => dispatch({ type: MapActionsTypes.delete_all_layers }),
        reset_map: () => dispatch({ type: MapActionsTypes.reset_map }),
    };
    // //console.log(state, actions)
    return { state, actions };
}

export { useMap };