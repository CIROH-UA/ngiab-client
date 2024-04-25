import { useContext} from 'react';
import MapContext from '../contexts/MapContext';


export const useMapContext = () => {
    return useContext(MapContext)
}