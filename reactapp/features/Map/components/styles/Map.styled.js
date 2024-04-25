import styled from "styled-components";

export const MapContainer = styled.div`
  & .ol-map {
    width: 100%;
    height: 100%;
  }
  flex: 1 1 60%;
  order: 1;
  width: 100%;
  overflow-y: hidden;
  position: absolute;
  height: 100%;

  #progress {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 10; // Make sure it sits on top of the map
  }
`;
