import { useContext} from 'react';
import DataStreamContext from '../contexts/dataStreamContext';


export const useDataStreamContext = () => {
    return useContext(DataStreamContext)
}