import React, { useReducer } from 'react';
import { timeSeriesInitialStore, timeSeriesReducer } from '../store/reducers/timeSeriesReducer';
import { timseSeriesActionsTypes } from '../store/actions/actionsTypes';

const useTimeSeries = () => {
    const [state, dispatch] = useReducer(timeSeriesReducer, timeSeriesInitialStore);
    const actions = {
        set_series: (series) => dispatch({ type: timseSeriesActionsTypes.set_series, payload: series }),
        set_chart_layout: (chart_layout) => dispatch({ type: timseSeriesActionsTypes.set_chart_layout, payload: chart_layout }),
    };
    return { state, actions };
}

export { useTimeSeries };