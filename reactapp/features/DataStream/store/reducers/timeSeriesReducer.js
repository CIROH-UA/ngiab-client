import { timseSeriesActionsTypes } from "../actions/actionsTypes";

const timeSeriesInitialStore = {
    state:{
        series: [],
        chart_layout: {},
    },
    actions:{}
};

const timeSeriesReducer = (state, action) => {
    switch (action.type) {
        case timseSeriesActionsTypes.set_series:
            return {
                ...state,
                state: {
                    ...state.state,
                    series: action.payload
                }
            };
        case timseSeriesActionsTypes.set_chart_layout:
            return {
                ...state,
                state: {
                    ...state.state,
                    chart_layout: action.payload
                }
            };            
        default:
            return state;
    }
}

export { timeSeriesInitialStore, timeSeriesReducer };
