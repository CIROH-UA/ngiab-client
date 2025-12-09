import { create } from 'zustand';
// Define the store
const useTimeSeriesStore = create((set) => ({
    series: [],
    feature_id: null,
    variable: '',
    layout: {
        "yaxis": "Streamflow",
        "xaxis": "Simulation Time Period (YYYY-MM-DD)",
        "title": "TimeSeries",
    },
    table: '',
    set_table: (newTable) => set({table: newTable}),
    set_feature_id: (newFeatureId) => set({ feature_id: newFeatureId }),
    set_series: (newSeries) => set({ series: newSeries }),
    set_chart_layout: (newLayout) => set({ chart_layout: newLayout }),
    set_variable: (newVariable) => set({ variable: newVariable }),
    set_layout: (newLayout) => set({layout: newLayout }),
    reset_series: () => set({ series: [] }),
    reset: () => set({
        series: [],
        feature_id: null,
        variable: '',
        layout: {
            "yaxis": "Streamflow",
            "xaxis": "Simulation Time Period (YYYY-MM-DD)",
            "title": "TimeSeries",
        },
        table: '',
    }),
}));
export default useTimeSeriesStore;