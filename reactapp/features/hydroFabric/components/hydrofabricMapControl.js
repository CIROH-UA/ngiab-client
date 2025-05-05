import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { Fragment, useEffect } from 'react';
import Form from 'react-bootstrap/Form';
import styled from 'styled-components';




const StyledControllerContainer = styled.div`
    display: ${props => props.isVisible ? 'block' : 'none'};
    margin-top: 1rem;
    width: 100%;
    border-radius: 0.5rem;
`;

const StyledSwitch = styled(Form.Switch)`
    margin-top: 10px;  

`;

const HydrofabricMapControl = ({
  isVisible
}) => {
  const { state, actions } = useHydroFabricContext();

  const handleToggleNexusClustering = () => {
    actions.toggle_nexus_geometry_clusters();
  };
  const handleToggleNexusLayer = () => {
    actions.toggle_nexus_geometry_hidden();
  };
  const handleToggleCatchmentLayer = () => {
    actions.toggle_catchment_geometry_hidden();
  };


  return (
    
    <Fragment>
        <StyledControllerContainer isVisible={isVisible}>        
          <h5>Layer's Control</h5>
          <StyledSwitch
            label="Nexus Layer"
            id="nexus-layer-switch"
            checked={!state.nexus.geometry.hidden}
            onChange={handleToggleNexusLayer}
            title="Toggle Nexus Layer visualization"
          />
          <StyledSwitch
            label="Nexus Clustering"
            id="nexus-clustering-switch"
            checked={state.nexus.geometry.clustered}
            onChange={handleToggleNexusClustering}
            title="Toggle nexus clustering visualization"
          />
          <StyledSwitch
            label="Catchment Layer"
            id="catchment-layer-switch"
            checked={!state.catchment.geometry.hidden}
            onChange={handleToggleCatchmentLayer}
            title="Toggle Catchment Layer visualization"
          />
        </StyledControllerContainer>
    </Fragment>
  );
};

export default HydrofabricMapControl;