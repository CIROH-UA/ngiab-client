import styled from "styled-components";

export const HydroFabricContainer = styled.div`
  flex: ${props => props.fullScreen ? '1 1 0%' : '1 1 40%'};
  order: 2;
  width: 100%;
  display: ${props => props.fullScreen ? 'none' : 'flex'};
  padding:10px;
  flex-direction:row;
`;

export const HydroFabricPlotContainer = styled.div`
  width: 500px; 
  height: 250px; 
  order: 1;
  flex: 1 1 80%;
`;

export const SelectContainer = styled.div`
  display: flex;
  flex-direction: column;
  order: 1;
  width: 100%;
  padding: 5px;
  flex: 1 1 20%;
`;

export const MapContainer = styled.div`
  flex: ${props => props.fullScreen ? '1 1 100%' : '1 1 60%'};
  order: 1;
  width: 100%;
  overflow-y: hidden;
  height: ${props => props.fullScreen ? '100%' : '60%'};
`;

export const TeehrMetricsWrapper = styled.div`
  width: 100%;
  height:100%;
  padding: 10px;
  background-color: #f8f8f8;
  border-bottom: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  order: 1;
  flex: 1 1 20%;
`;