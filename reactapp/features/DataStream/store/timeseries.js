import { create } from 'zustand';
// Define the store
const useTimeSeriesStore = create((set) => ({
    series: [],
    layout: {
        "yaxis": "Streamflow",
        "xaxis": "",
        "title": "",
    },
    set_series: (newSeries) => set({ series: newSeries }),
    set_chart_layout: (newLayout) => set({ chart_layout: newLayout }),
}));
export default useTimeSeriesStore;