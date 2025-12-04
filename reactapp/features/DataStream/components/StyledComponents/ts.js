import styled from 'styled-components';
import { Button, Form } from 'react-bootstrap';
import useTheme from 'hooks/useTheme';



const StyledPopupContent = styled.div`
  width: 100%;
  max-width: 100%;
  padding: 8px 10px;
  // border-radius: 6px;
  background-color: ${(props) =>
    props.theme === 'dark' ? '#2b333b' : '#ffffff'};
  color: ${(props) =>
    props.theme === 'dark' ? '#f8f9fa' : '#212529'};

  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-size: 12px;
  line-height: 1.4;

  display: flex;
  flex-direction: column;
  gap: 4px;

  .popup-title {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
  }

  .popup-row {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }

  .popup-label {
    font-weight: 500;
    opacity: 0.8;
  }

  .popup-value {
    font-family: monospace;
    word-break: break-all;
  }

`;

export const PopupContent = (props) => {
  const theme = useTheme();
  return <StyledPopupContent {...props} theme={theme} />;
};

export const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  width: 400px;
  background-color: #4f5b679e;
  color: #fff;
  padding-top: 120px;
  z-index: 1000;
  transition: transform 0.3s ease;

  /* When closed, shift left so that only 40px remains visible */
  transform: ${({ $isOpen }) =>
    $isOpen ? 'translateX(0)' : 'translateX(calc(-100%))'};

  /* On small screens, use 100% width */
  @media (max-width: 768px) {
    width: 100%;
    transform: ${({ $isOpen }) =>
      $isOpen ? 'translateX(0)' : 'translateX(calc(-100%))'};
  }
`;


export const XButton = styled(Button)`  
  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  border-radius: 2px;
  padding: 7px 8px;
  width: 100%;
  z-index: 1001;

  &:hover,
  &:focus {
    background-color: rgba(0, 0, 0, 0.1) !important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

export const LoadingMessage = styled.div`
  color: white;
  padding: 10px;
  border-radius: 5px;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
  width: 100%;
  text-align: center;
  opacity: 0.8;
  transition: opacity 0.3s ease;
  &:hover {
    opacity: 1;
  }
`;

export const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
`;

export const IconLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  margin-bottom: 8px;

`
export const Title = styled.span`
    letter-spacing: .0125em;
    font-family: "Google Sans", Roboto, Arial, sans-serif;
    font-weight: bold;
    font-size: 16px;
    line-height: 24px;
    align-items: center;
`
export const ToggleButton = styled(Button)`
  top: ${({ $top = 0 }) => `${$top}px`};
  left: ${(props) => (props.$currentMenu ? '410px' : '20px')};
  position: absolute;

  margin-top: 10px;

  transition: transform 0.3s ease;

  background-color: #009989;
  border: none;
  color: white;
  border-radius: 5px;
  padding: 3px 10px;
  z-index: 1001;

  &:hover {
    background-color: #000000b3;
    color: white;
    border: none;
    box-shadow: none;
  }
`;


export const Switch = styled(Form.Switch)`
  
`;


export const Content = styled.div`
  padding: 16px;
  border-block: 1px solid rgb(218, 220, 224);
  padding-block-start: 8px;
  a {
    color: white;
  }
`;

