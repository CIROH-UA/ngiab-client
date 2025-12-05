import { create } from 'zustand';
// Define the store
const useDataStreamStore = create((set) => ({
    bucket: 'ciroh-community-ngen-datastream',
    nexus_pmtiles: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/nexus.pmtiles',
    community_pmtiles: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles',
    cache_key: null,
    vpu: `VPU_01`,
    // date: `ngen.${getTodayDateString()}`,
    date: 'ngen.20251125',
    forecast: 'short_range',
    time: null,
    cycle: '00',
    variables: [],

    set_bucket: (newBucket) => set({ bucket: newBucket }),
    set_cache_key: (newCacheKey) => set({ cache_key: newCacheKey }),
    set_vpu: (newVpu) => set({ vpu: newVpu }),
    set_date: (newDate) => set({ date: newDate }),
    set_forecast: (newForecast) => set({ forecast: newForecast }),
    set_time: (newTime) => set({ time: newTime }),
    set_cycle: (newCycle) => set({ cycle: newCycle }),
    set_nexus_pmtiles: (newNexusPmtiles) => set({ nexus_pmtiles: newNexusPmtiles }),
    set_variables: (newVariables) => set({ variables: newVariables }),
    reset: () => set({
        bucket: 'ciroh-community-ngen-datastream',
        nexus_pmtiles: 'http://localhost:9000/ciroh-community-ngen-datastream/v2.2_resources/VPU_01/config/nexus.pmtiles',
        cache_key: null,
        vpu: `VPU_01`,
        date: 'ngen.20251125',
        forecast: 'short_range',
        time: null,
        cycle: '00',
        variables: [],
    }),
}));
export default useDataStreamStore;