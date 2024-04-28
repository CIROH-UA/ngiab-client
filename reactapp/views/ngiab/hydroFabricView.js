

import React,{useEffect, Fragment} from 'react';

import HydroFabricLinePlot from '../../features/hydroFabric/components/hydroFabricLinePlot';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import SelectComponent from 'features/hydroFabric/components/selectComponent';


const HydroFabricView = (props) => {
  const {state,actions} = useHydroFabricContext();
  
  useEffect(() => {
    if (!state.nexus.id) return;
    var params = {
      nexus_id: state.nexus.id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      actions.set_nexus_series(response.data);
      props.toggleSingleRow(false);

    }).catch((error) => {
      console.log("Error fetching nexus time series", error);
    })
    return  () => {

    }

  }, [state.nexus.id]);


  return (
    <Fragment>
      <h5>Catchment ID Selection</h5>
      <SelectComponent state={state.nexus} set_id={actions.set_nexus_id} />
      <HydroFabricLinePlot singleRowOn={props.singleRowOn} />
    </Fragment>



  );
};

export default HydroFabricView;
  