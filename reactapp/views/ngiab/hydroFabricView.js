

import React,{useEffect} from 'react';

import { HydroFabricContainer } from '../../features/hydroFabric/components/hydroFabric.styled';
import HydroFabricLinePlot from '../../features/hydroFabric/components/hydroFabricLinePlot';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';




const HydroFabricView = () => {
  const {state,actions} = useHydroFabricContext();

  useEffect(() => {
    if (!state.nexus.id) return;
    console.log("nexus id changed", state.nexus.id)
    var params = {
      nexus_id: state.nexus.id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      console.log("nexus time series", response);
      actions.set_nexus_series(response);

    }).catch((error) => {
      console.log("Error fetching nexus time series", error);
    })
    return  () => {

    }

  }, [state.nexus.id]);


  return (
        <HydroFabricContainer>
            <HydroFabricLinePlot data={state.nexus.series}/>
        </HydroFabricContainer>
  );
};

export default HydroFabricView;
  