// containers.js
import styled from 'styled-components';
import useTheme from 'hooks/useTheme';

// HydroFabricContainer
const StyledHydroFabricContainer = styled.div`
  // flex: ${(props) => (props.$fullScreen ? '1 1 0%' : '1 1 40%')};
  height: ${(props) => (props.$fullScreen ? '0%' : '40%;')};
  // order: 2;
  width: ${(props) => (props.isModelRunListOpen ? '80%' : '100%')};
  margin-left: ${(props) => (props.isModelRunListOpen ? '20%' : '0%')};
  padding: ${(props) => (props.$fullScreen ? '0px' : '5px;')}; 
  background-color: ${(props) => props.theme === 'dark' ? '#4f5b67' : '#ffffff'};
  position: absolute;
  bottom: 0;
  right: 0;
  left: 0;
  z-index: 1001;
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  
  /* For even smoother animation, include width in the transition */
  @media (min-width: 768px) {
    transition: margin-left 0.5s cubic-bezier(0.4, 0, 0.2, 1), 
                width 0.5s cubic-bezier(0.4, 0, 0.2, 1),
                transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  }
`;

export const HydroFabricContainer = (props) => {
  const theme = useTheme();
  return <StyledHydroFabricContainer {...props} theme={theme} />;
};

// HydroFabricPlotContainer
const StyledHydroFabricPlotContainer = styled.div`
  width: 100%;
  padding: 5px;
  height: 300px;
  order: 1;
  flex: 1 1 80%;
  background-color: ${(props) => props.theme === 'dark' ? '#4f5b67' : '#f9f9f9'};
`;

export const HydroFabricPlotContainer = (props) => {
  const theme = useTheme();
  return <StyledHydroFabricPlotContainer {...props} theme={theme} />;
};

// SelectContainer
const StyledSelectContainer = styled.div`
  display: flex;
  flex-direction: column;
  order: 1;
  width: 100%;
  padding: 5px;
  flex: 1 1 20%;
  background-color: ${(props) =>
    props.theme === 'dark' ? '#4f5b67' : '#ffffff'};
  color: ${(props) => (props.theme === 'dark' ? '#ffffff' : '#000000')};
`;

export const SelectContainer = (props) => {
  const theme = useTheme();
  return <StyledSelectContainer {...props} theme={theme} />;
};

// MapContainer
const StyledMapContainer = styled.div`
  flex: ${(props) => (props.$fullScreen ? '1 1 100%' : '1 1 60%')};
  order: 1;
  width: 100%;
  overflow-y: hidden;
  height: ${(props) => (props.$fullScreen ? '100%' : '60%')};
  background-color: ${(props) =>
    props.theme === 'dark' ? '#1f1f1f' : '#f9f9f9'};
`;

export const MapContainer = (props) => {
  const theme = useTheme();
  return <StyledMapContainer {...props} theme={theme} />;
};

// TeehrMetricsWrapper
const StyledTeehrMetricsWrapper = styled.div`
  width: 100%;
  height: 100%;
  padding: 10px;
  background-color: ${(props) =>
    props.theme === 'dark' ? '#4f5b67' : '#f8f8f8'};
  border-bottom: 1px solid
    ${(props) => (props.theme === 'dark' ? '#444444' : '#ddd')};
  display: flex;
  flex-direction: column;
  order: 1;
  flex: 1 1 20%;
  color: ${(props) => (props.theme === 'dark' ? '#ffffff' : '#000000')};
`;

export const TeehrMetricsWrapper = (props) => {
  const theme = useTheme();
  return <StyledTeehrMetricsWrapper {...props} theme={theme} />;
};



const StyledTimeSeriesContainer = styled.div`
    position: absolute;
    display: ${props => props.singleRowOn ? 'none' : 'block'};
    top: 60px;
    left: 0.5rem;
    padding: 10px;
    background-color: ${(props) =>
      props.theme === 'dark' ? '#4f5b67' : '#f8f8f8'};
    ${(props) => (props.theme === 'dark' ? '#444444' : '#ddd')};
    width: 300px;
    border-radius: 0.5rem;  
    color: ${(props) => (props.theme === 'dark' ? '#ffffff' : '#000000')};
`;

export const TimeSeriesContainer = (props) => {
  const theme = useTheme();
  return <StyledTimeSeriesContainer {...props} theme={theme} />;
};