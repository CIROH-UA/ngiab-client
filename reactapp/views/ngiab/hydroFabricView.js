

import {useEffect, Suspense, Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import { SelectContainer,HydroFabricPlotContainer } from './containers';
import LoadingAnimation from 'components/loader/LoadingAnimation';


const HydroFabricLinePlot = lazy(() => import('../../features/hydroFabric/components/hydroFabricLinePlot'));
const SelectComponent = lazy(() => import('../../features/hydroFabric/components/selectComponent'));

const HydroFabricView = (props) => {
  const {state,actions} = useHydroFabricContext();

  useEffect(() => {
    if (!state.nexus.id) return;
    actions.reset_catchment();
    var params = {
      nexus_id: state.nexus.id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      actions.set_nexus_series(response.data);
      actions.set_nexus_list(response.nexus_ids);
      actions.set_troute_id(state.nexus.id);
      props.toggleSingleRow(false);
    }).catch((error) => {
      console.log("Error fetching nexus time series", error);
    })
    return  () => {
      if(state.nexus.id) return
      actions.reset_nexus();
    }

  }, [state.nexus.id]);

  useEffect(() => {
    if (!state.troute.id) return;
    props.setIsLoading(true);
    var params = {
      troute_id: state.troute.id
    }
    appAPI.getTrouteVariables(params).then((response) => {
      actions.set_troute_variable_list(response.troute_variables);
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      props.setIsLoading(false);
      console.log("Error fetching troute variables", error);
    })
    return  () => {
      if (state.troute.id) return;
      actions.reset_troute();
    }
  },[state.troute.id]);


  useEffect(() => {
    if (!state.troute.variable || !state.troute.id) return;
    props.setIsLoading(true);
    var params = {
      troute_id: state.troute.id,
      troute_variable: state.troute.variable
    }
    appAPI.getTrouteTimeSeries(params).then((response) => {
      actions.set_troute_series(response.data);
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      props.setIsLoading(false);
      console.log("Error fetching troute time series", error);
    })
    return  () => {
      if (state.troute.id) return;
      actions.reset_troute();
    }
  },[state.troute.variable]);



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
      actions.set_catchment_variable(null);
      actions.set_catchment_list(response.catchment_ids);
      actions.set_troute_id(state.catchment.id);
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      props.setIsLoading(false);
      console.log("Error fetching catchment time series", error);
    })
    return  () => {
      if (state.catchment.id) return;
      actions.reset_catchment();
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
      actions.set_catchment_series(response.data);
      props.toggleSingleRow(false);
      props.setIsLoading(false);
    }).catch((error) => {
      props.setIsLoading(false);
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
              <h5>Catchment Metadata</h5>
              <p><b>ID</b>: {state.catchment.id}</p>
                <label>Current Catchment ID </label>
                <SelectComponent 
                  optionsList={state.catchment.list} 
                  onChangeHandler={actions.set_catchment_id} 
                  defaultValue={
                    {
                      'value': state.catchment.id,
                      'label': state.catchment.id
                    }
                  }
                />
              <label>Current Variable</label>
              <SelectComponent 
                optionsList={state.catchment.variable_list} 
                onChangeHandler={actions.set_catchment_variable}
                defaultValue={
                  {
                    'value': state.catchment.variable ? state.catchment.variable : state.catchment.variable_list ? state.catchment.variable_list[0].value : 'select variable',
                    'label': state.catchment.variable ? state.catchment.variable.toLowerCase().replace(/_/g, " ") : state.catchment.variable_list ? state.catchment.variable_list[0].label : 'select variable',
                  }

                }
              />
            </Fragment>

          }
        {state.nexus.id &&
        <Fragment>
            <h5>Nexus Metadata</h5>
            <p><b>ID</b>: {state.nexus.id}</p>
            <label>Current Nexus ID</label>
            <SelectComponent 
              optionsList={state.nexus.list} 
              onChangeHandler={actions.set_nexus_id}
              defaultValue={
                {
                  'value': state.nexus.id,
                  'label': state.nexus.id
                }
              }
            />
        </Fragment>
        
        }

        {
          state.troute.id &&
          <Fragment>
            <h5>Troute</h5>
            <label>Current Variable</label>
            <SelectComponent 
              optionsList={state.troute.variable_list} 
              onChangeHandler={actions.set_troute_variable}
            />
          </Fragment>
        }


      </SelectContainer>
      <Suspense fallback={<LoadingAnimation />}>
       <HydroFabricPlotContainer>
          <HydroFabricLinePlot singleRowOn={props.singleRowOn}/> 
        </HydroFabricPlotContainer> 
      </Suspense>

    </Fragment>



  );
};

export default HydroFabricView;