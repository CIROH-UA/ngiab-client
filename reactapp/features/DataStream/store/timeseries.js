import { create } from 'zustand';
// Define the store
const useTimeSeriesStore = create((set) => ({
    series: [],
    feature_id: null,
    variable: 'flow',
    layout: {
        "yaxis": "Streamflow",
        "xaxis": "",
        "title": "",
    },
    table: '',
    set_table: (newTable) => set({table: newTable}),
    set_feature_id: (newFeatureId) => set({ feature_id: newFeatureId }),
    set_series: (newSeries) => set({ series: newSeries }),
    set_chart_layout: (newLayout) => set({ chart_layout: newLayout }),
    set_variable: (newVariable) => set({ variable: newVariable }),
}));
export default useTimeSeriesStore;