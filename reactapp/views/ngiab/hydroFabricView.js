

import {useEffect, Suspense, Fragment,lazy} from 'react';

// import HydroFabricLinePlot from '../../features/hydroFabric/components/hydroFabricLinePlot';
// import SelectComponent from 'features/hydroFabric/components/selectComponent';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import { SelectContainer,HydroFabricPlotContainer } from './containers';
import LoadingAnimation from 'components/loader/LoadingAnimation';


const HydroFabricLinePlot = lazy(() => import('../../features/hydroFabric/components/hydroFabricLinePlot'));
const SelectComponent = lazy(() => import('../../features/hydroFabric/components/selectComponent'));

const HydroFabricView = (props) => {
  const {state,actions} = useHydroFabricContext();

  var title = `${state.nexus.id ? 'Nexus: '+ state.nexus.id.split("-")[1] : state.catchment.id ? 'Catchment: ' + state.catchment.id.split("-")[1] : ''}`
  var subtitle = `${state.nexus.id ? 'streamflow vs time' : state.catchment.variable_list ? state.catchment.variable_list[0]['label'] + ' vs time' : ''}`
  
  var defaultNexusID = {'value': state.nexus.id ? state.nexus.id : 'Select a Nexus ID'  ,'label': state.nexus.id ? state.nexus.id : 'Select a Nexus ID'};
  var defaultCatchmentID = {'value': state.catchment.id ? state.catchment.id : 'Select a Catchment ID'  ,'label': state.catchment.id ? state.catchment.id : 'Select a Catchment ID'};
  var defaultCatchmentVariable = {
    'value': state.catchment.id && state.catchment.variable ? state.catchment.variable : state.catchment.variable_list ? state.catchment.variable_list[0]['value'] : 'Select a Variable',
    'label': state.catchment.id && state.catchment.variable ? state.catchment.variable : state.catchment.variable_list ? state.catchment.variable_list[0]['label'] : 'Select a Variable'
  };
  useEffect(() => {
    if (!state.nexus.id) return;
    actions.reset_catchment();
    var params = {
      nexus_id: state.nexus.id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      actions.set_nexus_series(response.data);
      actions.set_nexus_list(response.nexus_ids);
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
    console.log(state.catchment.id)
    var params = {
      catchment_id: state.catchment.id
    }
    appAPI.getCatchmentTimeSeries(params).then((response) => {
      console.log(response)
      actions.set_catchment_series(response.data);
      actions.set_catchment_variable_list(response.variables);
      // actions.set_catchment_variable(response.variable);
      actions.set_catchment_list(response.catchment_ids);
      props.toggleSingleRow(false);
      props.setIsLoading(false);

    }).catch((error) => {
      props.setIsLoading(false);
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
              <h5>Catchment Metadata</h5>
              <p><b>ID</b>: {state.catchment.id}</p>
              <div>
                <label>Current Catchment ID </label>
                <SelectComponent 
                  optionsList={state.catchment.list} 
                  onChangeHandler={actions.set_catchment_id} 
                  defaultValue={defaultCatchmentID}
                />
              </div>
              <div>
                <label>Current Variable</label>
                <SelectComponent 
                  optionsList={state.catchment.variable_list} 
                  onChangeHandler={actions.set_catchment_variable}
                  defaultValue={defaultCatchmentVariable}
                />
              </div>
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
              defaultValue={defaultNexusID}
            />
        </Fragment>

        }
      </SelectContainer>
      <Suspense fallback={<LoadingAnimation />}>
       <HydroFabricPlotContainer>
          <HydroFabricLinePlot singleRowOn={props.singleRowOn} title={title} subtitle={subtitle} /> 
        </HydroFabricPlotContainer> 
      </Suspense>

    </Fragment>



  );
};

export default HydroFabricView;
  