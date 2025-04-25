import { useContext} from 'react';
import DataStreamModelRunsContext from '../contexts/dataStreamModelRunsContext';


export const useDataStreamModelRunsContext = () => {
    return useContext(DataStreamModelRunsContext)
}