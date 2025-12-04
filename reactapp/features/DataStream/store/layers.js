import { create } from 'zustand';

const useLayersStore = create((set) => ({
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
export default useLayersStore;