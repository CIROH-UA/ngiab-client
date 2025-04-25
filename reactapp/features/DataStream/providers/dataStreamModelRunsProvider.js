import React, { useEffect } from 'react';
import DataStreamModelRunsContext from '../contexts/dataStreamModelRunsContext';
import {useDataStreamModelRuns} from '../hooks/useDataStreamModelRuns';

export const DataStreamModelRunsProvider = ({ children }) => {

  const {state,actions} = useDataStreamModelRuns();

  return (
    <DataStreamModelRunsContext.Provider value={{ ...state, actions }}>  
      {children}
    </DataStreamModelRunsContext.Provider>
  );
};