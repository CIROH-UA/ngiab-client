import React, { useEffect } from 'react';
import HydroFabricContext from 'old/features/hydroFabric/contexts/hydroFabricContext';
import { useHydroFabric } from '../hooks/useHydroFabric';

export const HydroFabricProvider = ({ children }) => {

  const {state,actions} = useHydroFabric();



  return (
    <HydroFabricContext.Provider value={{ ...state, actions }}>  
      {children}
    </HydroFabricContext.Provider>
  );
};