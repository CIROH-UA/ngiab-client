// import React, { useReducer } from 'react';
// import { dataStreamInitialStore, dataStreamReducer } from '../store/reducers/dataStreamReducer';

// import { dataStreamActionsTypes } from '../store/actions/actionsTypes';


// const useDataStream = () => {
//     const [state, dispatch] = useReducer(dataStreamReducer, dataStreamInitialStore);
//     const actions = {
//         set_bucket: (bucket) => dispatch({ type: dataStreamActionsTypes.set_bucket, payload: bucket }),
//         set_cache_key: (cache_key) => dispatch({ type: dataStreamActionsTypes.set_cache_key, payload: cache_key }),
//         set_vpu: (vpu) => dispatch({ type: dataStreamActionsTypes.set_vpu, payload: vpu }),
//         set_date: (date) => dispatch({ type: dataStreamActionsTypes.set_date, payload: date }),
//         set_forecast: (forecast) => dispatch({ type: dataStreamActionsTypes.set_forecast, payload: forecast }),
//         set_time: (time) => dispatch({ type: dataStreamActionsTypes.set_time, payload: time }),
//         set_cycle: (cycle) => dispatch({ type: dataStreamActionsTypes.set_cycle, payload: cycle }),
//         set_geometry: (geometry) => dispatch({ type: dataStreamActionsTypes.set_geometry, payload: geometry }),
//         set_variables: (variables) => dispatch({ type: dataStreamActionsTypes.set_variables, payload: variables }),
//         reset: () => dispatch({ type: dataStreamActionsTypes.reset }),
//     };
//     return { state, actions };
// }

// export { useDataStream };