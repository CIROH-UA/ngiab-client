

import React,{useEffect, Fragment, useState} from 'react';

import HydroFabricLinePlot from '../../features/hydroFabric/components/hydroFabricLinePlot';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import SelectComponent from 'features/hydroFabric/components/selectComponent';
import { SelectContainer } from './containers';

const HydroFabricView = (props) => {
  const {state,actions} = useHydroFabricContext();

  const title = `${state.catchment.id ? 'Catchment: '+ state.catchment.id.split('cat-')['1'] : 'Nexus: ' + state.nexus.id } Time Series`;
  var subtitle = `${state.catchment.id ? state.catchment.variable + ' vs Time' : 'Flow (CFS) vs Time'}`

  useEffect(() => {
    if (!state.nexus.id) return;
    actions.reset_catchment();
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


  useEffect(() => {
    if (!state.catchment.id) return;
    actions.reset_nexus();
    props.setIsLoading(true);
    var params = {
      catchment_id: state.catchment.id
    }
    appAPI.getCatchmentTimeSeries(params).then((response) => {
      actions.set_catchment_series(response.data);
      actions.set_catchment_variable_list(response.variables);
      subtitle = response.variable
      // actions.set_catchment_variable(response.variable);
      actions.set_catchment_list(response.catchment_ids);
      props.toggleSingleRow(false);
      props.setIsLoading(false);

    }).catch((error) => {
      console.log("Error fetching catchment time series", error);
    })
    return  () => {

    }

  }, [state.catchment.id]);


  useEffect(() => {
    if (!state.catchment.variable) return;
    props.setIsLoading(true);

    var params = {
      catchment_id: state.catchment.id,
      variable_column: state.catchment.variable
    }    
    appAPI.getCatchmentTimeSeries(params).then((response) => {
      console.log(response)
      actions.set_catchment_series(response.data);
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      console.log("Error fetching nexus time series", error);
    })
    return  () => {

    }

  }, [state.catchment.variable]);


  return (
    <Fragment>
        <SelectContainer>
          {state.catchment.id &&
            <Fragment>
              <div>
                <label>Select/Look a Catchment ID </label>
                <SelectComponent optionsList={state.catchment.list} onChangeHandler={actions.set_catchment_id} />
              </div>
              <div>
                <label>Select a Variable</label>
                <SelectComponent optionsList={state.catchment.variable_list} onChangeHandler={actions.set_catchment_variable} />
              </div>
            </Fragment>

          }
        {state.nexus.id &&
        <Fragment>
            <label>Select/Look a Nexus ID</label>
            <SelectComponent optionsList={state.nexus.list} onChangeHandler={actions.set_nexus_id} />
        </Fragment>

        }
      </SelectContainer>

      <HydroFabricLinePlot singleRowOn={props.singleRowOn} title={title} subtitle={subtitle} />

    </Fragment>



  );
};

export default HydroFabricView;
  