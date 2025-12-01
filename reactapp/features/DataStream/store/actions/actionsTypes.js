const dataStreamActionsTypes = {
    set_bucket: 'SET_BUCKET',
    set_geometry: 'SET_CURRENT_GEOMETRY',
    set_vpu: 'SET_VPU',
    set_date: 'SET_DATE',
    set_forecast: 'SET_FORECAST',
    set_time: 'SET_TIME',
    set_cycle: 'SET_CYCLE',
    set_cache_key: 'SET_CACHE_KEY',
    reset: 'RESET',

};

const timseSeriesActionsTypes = {    
    set_series: 'SET_SERIES',
    set_chart_layout: 'SET_CHART_LAYOUT',
};

export { dataStreamActionsTypes, timseSeriesActionsTypes };