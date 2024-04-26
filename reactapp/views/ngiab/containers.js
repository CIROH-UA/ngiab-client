import styled from "styled-components";

export const HydroFabricContainer = styled.div`
  flex: ${props => props.fullScreen ? '1 1 0%' : '1 1 40%'};
  order: 2;
  width: 100%;
  overflow-y: hidden;
  height: ${props => props.fullScreen ? '0%' : '40%'};
`;

export const MapContainer = styled.div`
  flex: ${props => props.fullScreen ? '1 1 100%' : '1 1 60%'};
  order: 1;
  width: 100%;
  overflow-y: hidden;
  height: ${props => props.fullScreen ? '100%' : '60%'};
`;