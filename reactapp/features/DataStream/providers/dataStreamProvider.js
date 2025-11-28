import React, { useEffect } from 'react';
import DataStreamContext from '../contexts/dataStreamContext';
import {useDataStream} from '../hooks/useDataStream';

export const DataStreamProvider = ({ children }) => {
  const {state,actions} = useDataStream();
  return (
    <DataStreamContext.Provider value={{ ...state, actions }}>  
      {children}
    </DataStreamContext.Provider>
  );
};