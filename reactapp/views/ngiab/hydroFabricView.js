

import React,{useEffect, Fragment} from 'react';

import HydroFabricLinePlot from '../../features/hydroFabric/components/hydroFabricLinePlot';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import SelectComponent from 'features/hydroFabric/components/selectComponent';

const customStyles = {
  option: provided => ({
    ...provided,
    color: 'black'
  }),
  control: provided => ({
    ...provided,
    color: 'black'
  }),
  singleValue: provided => ({
    ...provided,
    color: 'black'
  })
}


const HydroFabricView = (props) => {
  const {state,actions} = useHydroFabricContext();
  console.log(actions)
  useEffect(() => {
    if (!state.nexus.id) return;
    console.log("nexus id changed", state.nexus.id)
    var params = {
      nexus_id: state.nexus.id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      console.log("nexus time series", response);
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
      <SelectComponent state={state.nexus} set_id={actions.set_nexus_id} />
      {/* <Select options={state.nexus.list} styles={customStyles} /> */}
      {/* <HydroFabricLinePlot data={state.nexus.series}/> */}
      <HydroFabricLinePlot singleRowOn={props.singleRowOn} />
    </Fragment>



  );
};

export default HydroFabricView;
  