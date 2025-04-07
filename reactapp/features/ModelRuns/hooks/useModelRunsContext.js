import { useContext} from 'react';
import ModelRunsContext from '../contexts/modelRunsContext';


export const useModelRunsContext = () => {
    return useContext(ModelRunsContext)
}