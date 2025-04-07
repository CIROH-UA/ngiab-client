// src/features/hydroFabric/store/actions/actionsTypes.js

const hydroFabricActionsTypes = {
    set_nexus_id: 'SET_NEXUS_ID',
    set_nexus_list: 'SET_NEXUS_LIST',
    set_nexus_series: 'SET_NEXUS_SERIES',
    set_nexus_chart_layout: 'SET_NEXUS_CHART_LAYOUT',
    toggle_nexus_geometry_clusters: 'TOGGLE_NEXUS_GEOMETRY_CLUSTERS',
    toggle_nexus_geometry_hidden: 'TOGGLE_NEXUS_GEOMETRY_HIDDEN',

    // NEW: explicit show/hide for nexus
    show_nexus_geometry: 'SHOW_NEXUS_GEOMETRY',
    hide_nexus_geometry: 'HIDE_NEXUS_GEOMETRY',

    set_catchment_list: 'SET_CATCHMENT_LIST',
    set_catchment_id: 'SET_CATCHMENT_ID',
    set_catchment_variable: 'SET_CATCHMENT_VARIABLE',
    set_catchment_variable_list: 'SET_CATCHMENT_VARIABLE_LIST',
    set_catchment_series: 'SET_CATCHMENT_SERIES',
    set_catchment_chart_layout: 'SET_CATCHMENT_CHART_LAYOUT',
    toggle_catchment_geometry_hidden: 'TOGGLE_CATCHMENT_GEOMETRY_HIDDEN',

    // NEW: explicit show/hide for catchments
    show_catchment_geometry: 'SHOW_CATCHMENT_GEOMETRY',
    hide_catchment_geometry: 'HIDE_CATCHMENT_GEOMETRY',

    // OPTIONAL: explicit enable/disable clustering
    enable_nexus_geometry_clusters: 'ENABLE_NEXUS_GEOMETRY_CLUSTERS',
    disable_nexus_geometry_clusters: 'DISABLE_NEXUS_GEOMETRY_CLUSTERS',

    set_troute_id: 'SET_TROUTE_ID',
    set_troute_variable: 'SET_TROUTE_VARIABLE',
    set_troute_variable_list: 'SET_TROUTE_VARIABLE_LIST',
    set_troute_series: 'SET_TROUTE_SERIES',
    set_troute_chart_layout: 'SET_TROUTE_CHART_LAYOUT',
    
    set_teehr_id: 'SET_TEEHR_ID',
    set_teehr_variable: 'SET_TEEHR_VARIABLE',
    set_teehr_variable_list: 'SET_TEEHR_VARIABLE_LIST',
    set_teehr_metrics: 'SET_TEEHR_METRICS',
    set_teehr_series: 'SET_TEEHR_SERIES',
    set_teehr_chart_layout: 'SET_TEEHR_CHART_LAYOUT',
    
    set_reset_teehr: 'SET_RESET_TEEHR',
    reset_nexus: 'RESET_NEXUS',
    reset_catchment: 'RESET_CATCHMENT',
    reset_troute: 'RESET_TROUTE',
    reset: 'RESET',
};

export { hydroFabricActionsTypes };
