

import React,{useEffect, Fragment} from 'react';

import HydroFabricLinePlot from '../../features/hydroFabric/components/hydroFabricLinePlot';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import appAPI from 'services/api/app';
import Select from 'react-select'


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



  useEffect(() => {
    if (!state.nexus.id) return;
    console.log("nexus id changed", state.nexus.id)
    var params = {
      nexus_id: state.nexus.id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      console.log("nexus time series", response);
      actions.set_nexus_series(response);
      props.toggleSingleRow(false);

    }).catch((error) => {
      console.log("Error fetching nexus time series", error);
    })
    return  () => {

    }

  }, [state.nexus.id]);


  return (
    <Fragment>
      <Select options={state.nexus.list} styles={customStyles} />
      <HydroFabricLinePlot data={state.nexus.series}/>
    </Fragment>



  );
};

export default HydroFabricView;
  