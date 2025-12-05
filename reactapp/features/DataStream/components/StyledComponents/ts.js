import styled from 'styled-components';
import { Button, Form, Modal } from 'react-bootstrap';
import useTheme from 'hooks/useTheme';


const TimeSeriesContainer = styled.div`
  width: 100%;
  height: 300px;
  order: 1;
  flex: 1 1 80%;
  background-color: ${(props) => props.theme === 'dark' ? '#1f2933' : '#f9f9f9'};
`;

export const TimeSeriesThemedContainer = (props) => {
  const theme = useTheme();
  return <TimeSeriesContainer {...props} theme={theme} />;
};



// Themed Modal wrapper
export const ThemedModal = styled(Modal)`
  .modal-content {
    background-color: ${({ $themeMode }) =>
      $themeMode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : '#ffffff'};
    color: ${({ $themeMode }) =>
      $themeMode === 'dark' ? '#f9fafb' : '#111827'};
    border-radius: 12px;
  }

  .modal-header,
  .modal-footer {
    border-color: ${({ $themeMode }) =>
      $themeMode === 'dark' ? '#374151' : '#e5e7eb'};
  }

  .btn-primary {
    background-color: #009989;
    border: none;
  }

  .btn-primary:hover,
  .btn-primary:focus {
    background-color: #007a6e;
  }
`;

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
  padding-top: 120px;
  padding-bottom: 16px;
  // background-color: #4f5b679e;
  background-color: #1f2933;
  color: #f9fafb;
  z-index: 1000;
  transition: transform 0.25s ease-out;
  
  border-radius: 0 12px 12px 0;
  overflow-y: auto;

  /* When closed, hide completely to the left */
  transform: ${({ $isOpen }) =>
    $isOpen ? 'translateX(0)' : 'translateX(-100%)'};

  @media (max-width: 768px) {
    width: 100%;
    border-radius: 0;
    transform: ${({ $isOpen }) =>
      $isOpen ? 'translateX(0)' : 'translateX(-100%)'};
  }
`;


export const XButton = styled(Button)`  
  background-color: rgba(255, 255, 255, 0.1);
  
  border: none;
  color: #f9fafb;
  border-radius: 2px;
  padding: 7px 8px;
  width: 100%;
  z-index: 1001;

  &:hover,
  &:focus {
    background-color: rgba(0, 0, 0, 0.1) !important;
    color: #f9fafb;    
    border: none;
    box-shadow: none;
  }
`;

export const SButton = styled(Button)`
  border: none;
  
  color: #f9fafb; 
  background-color: transparent;
  z-index: 1001;

  &:hover,
  &:focus {
    background-color: rgba(0, 0, 0, 0.08) !important;
    border: none;
    box-shadow: none;
  }
`;


export const LoadingMessage = styled.div`
  color: #e5e7eb;
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
  // margin-bottom: 10px;
  padding: 6px 0;
  margin-bottom: 2px;
  font-size: 13px;
`;

export const IconLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  // font-size: 14px;
  // margin-bottom: 8px;
  font-size: 13px;
  margin-bottom: 4px;

`
export const Title = styled.span`
    letter-spacing: .0125em;
    font-family: "Google Sans", Roboto, Arial, sans-serif;
    font-weight: 600;
    font-size: 15px;
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
  .form-check-input {
    width: 34px;
    height: 18px;
    cursor: pointer;
    background-color: rgba(148, 163, 184, 0.6);
    border-radius: 999px;
    border: none;
    box-shadow: none;
  }

  .form-check-input:checked {
    background-color: #009989; /* Google-style blue toggle */
  }

  .form-check-input:focus {
    box-shadow: none;
  }
`;

export const Content = styled.div`
  padding: 12px 16px;
  border-top: 1px solid rgba(148, 163, 184, 0.35);

  &:first-of-type {
    border-top: none;
  }
  a {
    color: #bfdbfe;
  }
`;

