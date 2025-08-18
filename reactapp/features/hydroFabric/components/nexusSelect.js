

import {useEffect, Fragment,lazy} from 'react';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import appAPI from 'services/api/app';
import SelectComponent from './selectComponent';
import { toast } from 'react-toastify';
import styled from 'styled-components';

const StyledLabel = styled.label`
  color: #ffffff !important;
  font-weight: 500;
  font-size: 0.9rem;
  margin-bottom: 6px;
  display: block;
  letter-spacing: 0.3px;
  
  /* Reduce font size for smaller screens */
  @media (max-width: 1366px) {
    font-size: 0.85rem;
    margin-bottom: 5px;
  }
  
  @media (max-width: 1024px) {
    font-size: 0.8rem;
    margin-bottom: 4px;
  }
`;

const SelectContainer = styled.div`
  margin-bottom: 12px;
  
  /* Reduce margin for smaller screens */
  @media (max-width: 1366px) {
    margin-bottom: 10px;
  }
  
  @media (max-width: 1024px) {
    margin-bottom: 8px;
  }
`;

const NexusSelect = (props) => {
  const {state,actions} = useHydroFabricContext();
  const {state: modelRunsState} = useModelRunsContext();

  useEffect(() => {
    if (!state.nexus.id) return;
    var params = {
      nexus_id: state.nexus.id,
      model_run_id: modelRunsState.base_model_id
    }    
    appAPI.getNexusTimeSeries(params).then((response) => {
      if (response.data.length === 0) {
        toast.info("No data available for this nexus and model run", { autoClose: 1000 });
      }

      actions.set_nexus_series(response.data);
      actions.set_nexus_chart_layout(response.layout);
      if(response.usgs_id){
        actions.set_teehr_id(response.usgs_id);
      }
      else{
        actions.reset_teehr();
      }
      
      actions.set_nexus_list(response.nexus_ids);
      
      actions.set_troute_id(state.nexus.id);
      props.toggleSingleRow(false);
    }).catch((error) => {
      toast.error("Error fetching nexus time series", { autoClose: 1000 });      
      console.log("Error fetching nexus time series", error);
    })
    return  () => {
      if(state.nexus.id) return
      actions.reset_nexus();
    }

  }, [state.nexus.id]);


  
  return (
    <Fragment>
        {state.nexus.id &&
            <Fragment>
                <SelectContainer>
                  <StyledLabel>Nexus ID</StyledLabel>
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
                </SelectContainer>
            </Fragment>
        }
    </Fragment>
  );
};

export default NexusSelect;