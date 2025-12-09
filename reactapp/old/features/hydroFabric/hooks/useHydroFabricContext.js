import { useContext} from 'react';
import HydroFabricContext from '../contexts/hydroFabricContext';


export const useHydroFabricContext = () => {
    return useContext(HydroFabricContext)
}