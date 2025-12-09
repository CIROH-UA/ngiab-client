import React, { useEffect } from 'react';
import ModelRunsContext from 'old/features/ModelRuns/contexts/modelRunsContext';
import { useModelRuns } from '../hooks/useModelRuns';

export const ModelRunsProvider = ({ children }) => {

  const {state,actions} = useModelRuns();

  return (
    <ModelRunsContext.Provider value={{ ...state, actions }}>  
      {children}
    </ModelRunsContext.Provider>
  );
};