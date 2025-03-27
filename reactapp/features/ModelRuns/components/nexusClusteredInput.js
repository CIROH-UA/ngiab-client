import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { Fragment } from 'react';
import Form from 'react-bootstrap/Form';
import styled from 'styled-components';

// Create a styled switch component
const StyledSwitch = styled(Form.Switch)`
    margin-top: 10px;  
`;

const NexusClusteredInput = () => {
  const { state, actions } = useHydroFabricContext();

  const handleToggleClustering = () => {
    actions.toggle_nexus_geometry_clusters();
  };

  return (
    <Fragment>
          <StyledSwitch
            label="Nexus Clustering"
            id="nexus-clustering-switch"
            checked={state.nexus?.geometry?.clustered ?? false}
            onChange={handleToggleClustering}
            title="Toggle nexus clustering visualization"
          />
    </Fragment>
  );
};

export default NexusClusteredInput;