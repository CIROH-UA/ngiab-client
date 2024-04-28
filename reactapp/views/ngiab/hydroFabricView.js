

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
      actions.reset_catchment();
      props.toggleSingleRow(false);

    }).catch((error) => {
      console.log("Error fetching nexus time series", error);
    })
    return  () => {

    }

  }, [state.nexus.id]);


  useEffect(() => {
    if (!state.catchment.id) return;
    var params = {
      catchment_id: state.catchment.id
    }
    console.log(params)    
    appAPI.getCatchmentTimeSeries(params).then((response) => {
      actions.set_catchment_series(response.data);
      actions.set_catchment_variable_list(response.list_variables);
      actions.set_catchment_variable(response.variable);
      actions.reset_nexus();
      props.toggleSingleRow(false);

    }).catch((error) => {
      console.log("Error fetching nexus time series", error);
    })
    return  () => {

    }

  }, [state.catchment.id]);



  return (
    <Fragment>
      {state.catchment.id &&
        <Fragment>
          <h5>Catchment ID Selection</h5>
          <SelectComponent state={state.catchment} set_id={actions.set_catchment_id} />
          <HydroFabricLinePlot singleRowOn={props.singleRowOn} />
        </Fragment>
      }
      {state.nexus.id &&
        <Fragment>
          <h5>Nexus ID Selection</h5>
          <SelectComponent state={state.catchment} set_id={actions.set_catchment_id} />
          <HydroFabricLinePlot singleRowOn={props.singleRowOn} />
        </Fragment>
      }
    </Fragment>



  );
};

export default HydroFabricView;
  