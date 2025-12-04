import { create } from 'zustand';

export const useLayersStore = create((set) => ({
    nexus: {
        visible: true,
    },
    catchments: {
        visible: true,
    },
    get_nexus_visibility: () => get().nexus.visible,
    get_catchments_visibility: () => get().catchments.visible,
    set_nexus_visibility: (isVisible) => set((state) => ({
        nexus: {
            ...state.nexus,
            visible: isVisible,
        },
    })),
    set_catchments_visibility: (isVisible) => set((state) => ({
        catchments: {
            ...state.catchments,
            visible: isVisible,
        },
    })),
    
}));


export const useFeatureStore = create((set) => ({
    hovered_feature: null,
    set_hovered_feature: (feature) =>
        set(() => ({
            hovered_feature: feature,
        })),
}));