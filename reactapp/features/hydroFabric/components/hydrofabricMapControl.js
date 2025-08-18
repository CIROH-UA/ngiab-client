import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { Fragment, useEffect } from 'react';
import Form from 'react-bootstrap/Form';
import styled from 'styled-components';

const StyledControllerContainer = styled.div`
    display: ${props => props.isVisible ? 'block' : 'none'};
    margin-top: 1rem;
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 15px;
    margin-bottom: 15px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(5px);
    
    /* Reduce padding for smaller screens */
    @media (max-width: 1366px) {
      padding: 12px;
      margin-bottom: 12px;
    }
    
    @media (max-width: 1024px) {
      padding: 10px;
      margin-bottom: 10px;
    }
`;

const LayerControlTitle = styled.h5`
  color: #ffffff !important;
  font-weight: 500;
  font-size: 1rem;
  margin-bottom: 15px;
  text-align: center;
  letter-spacing: 0.5px;
  position: relative;
  
  /* Reduce font size for smaller screens */
  @media (max-width: 1366px) {
    font-size: 0.9rem;
    margin-bottom: 12px;
  }
  
  @media (max-width: 1024px) {
    font-size: 0.85rem;
    margin-bottom: 10px;
  }
  
  &::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 2px;
    background: linear-gradient(135deg, #ffffff 0%, #cafeff 100%);
    border-radius: 1px;
  }
`;

const StyledSwitch = styled(Form.Switch)`
    margin-top: 12px;
    margin-bottom: 8px;
    
    /* Reduce margins for smaller screens */
    @media (max-width: 1366px) {
      margin-top: 10px;
      margin-bottom: 6px;
    }
    
    @media (max-width: 1024px) {
      margin-top: 8px;
      margin-bottom: 5px;
    }
    
    .form-check-input {
      background-color: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
      
      &:checked {
        background-color:#2e646f;
        border-color: #cafeff;
      }
      
      &:focus {
        box-shadow: 0 0 0 0.25rem rgba(202, 254, 255, 0.25);
      }
    }
    
    .form-check-label {
      color: #ffffff !important;
      font-weight: 400;
      font-size: 0.9rem;
      margin-left: 8px;
      
      /* Reduce font size for smaller screens */
      @media (max-width: 1366px) {
        font-size: 0.85rem;
      }
      
      @media (max-width: 1024px) {
        font-size: 0.8rem;
      }
    }
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
          <LayerControlTitle>Layer Controls</LayerControlTitle>
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