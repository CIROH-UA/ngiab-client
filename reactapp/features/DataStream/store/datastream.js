import { create } from 'zustand';
import { getYesterdayDateString } from '../lib/utils';

// Define the store
const useDataStreamStore = create((set) => ({
    bucket: 'ciroh-community-ngen-datastream',
    nexus_pmtiles: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/nexus.pmtiles',
    community_pmtiles: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles',
    // hydrofabric_index: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/hydrofabric_index.parquet',
    hydrofabric_index: 'http://localhost:9000/ciroh-community-ngen-datastream/v2.2_resources/hydrofabric_index.parquet',
    cache_key: null,
    vpu: `VPU_01`,
    model: 'cfe_nom',
    date: `ngen.${getYesterdayDateString()}`,
    dates: [],
    // date: 'ngen.20251125',
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
    set_model: (newModel) => set({ model: newModel }),
    set_nexus_pmtiles: (newNexusPmtiles) => set({ nexus_pmtiles: newNexusPmtiles }),
    set_community_pmtiles: (newCommunityPmtiles) => set({ community_pmtiles: newCommunityPmtiles }),
    set_hydrofabric_index: (newHydrofabricIndex) => set({ hydrofabric_index: newHydrofabricIndex }),
    set_variables: (newVariables) => set({ variables: newVariables }),
    set_dates: (newDates) => set({ dates: newDates }),
    reset: () => set({
        bucket: 'ciroh-community-ngen-datastream',
        nexus_pmtiles: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/nexus.pmtiles',
        community_pmtiles: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles',
        hydrofabric_index: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/hydrofabric_index.parquet',
        model: 'cfe_nom',
        cache_key: null,
        vpu: `VPU_01`,
        date: 'ngen.20251125',
        forecast: 'short_range',
        time: null,
        cycle: '00',
        variables: [],
        dates: [],
    }),
}));

export default useDataStreamStore;