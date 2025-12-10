import styled from 'styled-components';
import { Button, Form, Modal } from 'react-bootstrap';
import { FiSearch } from 'react-icons/fi';

export const TimeSeriesContainer = styled.div`
  width: 100%;
  height: 300px;
  order: 1;
  flex: 1 1 80%;
  background-color: var(--panel-background);
`;

// Themed Modal wrapper – now fully CSS-variable based
export const ThemedModal = styled(Modal)`
  .modal-content {
    background-color: var(--modal-bg);
    color: var(--modal-text-color);
    border-radius: 12px;
  }

  .modal-header,
  .modal-footer {
    border-color: var(--modal-border-color);
  }

  .btn-primary {
    background-color: var(--button-primary-bg);
    border: none;
  }

  .btn-primary:hover,
  .btn-primary:focus {
    background-color: var(--button-primary-hover-bg);
  }

  .modal-body a {
    color: var(--link-color);
  }
`;

export const PopupContent = styled.div`
  width: 100%;
  max-width: 100%;
  padding: 8px 10px;
  background-color: var(--popup-bg);
  color: var(--popup-text-color);

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

export const Container = styled.div`
  position: absolute;
  top: calc(var(--ts-header-height));
  left: 0;
  height: calc(100% - var(--ts-header-height));
  width: 400px;
  padding: 20px;
  background-color: var(--background-color);
  color: var(--map-panel-text);

  z-index: 1000;
  transition: transform 0.25s ease-out;

  overflow-y: auto;

  transform: ${({ $isOpen }) =>
    $isOpen ? 'translateX(0)' : 'translateX(-100%)'};

  @media (max-width: 768px) {
    width: 100%;
    border-radius: 0;
    transform: ${({ $isOpen }) =>
      $isOpen ? 'translateX(0)' : 'translateX(-100%)'};
  }
`;

export const LayersContainer = styled.div`
  position: absolute;
  top: calc(var(--ts-header-height) + 16px);
  right: 10px;
  width: 250px;
  padding: 15px;
  background-color: var(--map-panel-bg);
  color: var(--map-panel-text);
  z-index: 1000;

  border-radius: 8px;
  overflow-y: auto;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

  @media (max-width: 768px) {
    width: 100%;
    border-radius: 0;
  }
`;

export const LayerButton = styled(Button)`
  top: 60px;
  right: 1%;
  position: absolute;
  margin-top: 10px;
  transition: transform 0.3s ease;

  background-color: ${({ $bgColor = 'var(--button-primary-bg)' }) =>
    $bgColor};
  border: none;
  color: var(--accent-text);
  border-radius: 20px;
  padding: 7px 8px;
  z-index: 1001;

  &:hover,
  &:focus {
    color: var(--hover-text);
    background-color: ${({ $bgColor = 'var(--button-primary-bg)' }) => $bgColor};
    border: none;
    box-shadow: none;
  }
`;

export const XButton = styled(Button)`
  background-color: var(--button-primary-bg);
  color: var(--text-color);
  border-radius: 8px;
  padding: 7px 8px;
  width: 100%;
  z-index: 1001;
  box-shadow: none;
  border-radius: 20px;
  border-color: transparent;
  border: none;
  &:hover,
  &:focus {
    background-color: var(--button-primary-hover-bg);
    color: var(--button-primary-text-hover);
    box-shadow: 0 1px 2px 0 rgba(60, 64, 67, .3), 0 1px 3px 1px rgba(60, 64, 67, .15);
  }
`;

export const SButton = styled(Button)`
  border: none;
  color: var(--text-color);
  background-color: transparent;
  z-index: 1001;
  border-radius: 20px;
  &:hover,
  &:focus {
    background-color: var(--button-primary-hover-bg); ;
    color: var(--button-primary-text-hover);
    border: none;
    box-shadow: none;
  }
`;

export const LoadingMessage = styled.div`
  color: var(--muted-text);
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
  padding: 6px 0;
  margin-bottom: 2px;
  font-size: 13px;
`;

export const IconLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: ${({ $fontSize = '13' }) => `${$fontSize}px`};
  margin-bottom: 4px;
  color: var(--accent-text);
`;

export const Title = styled.span`
  letter-spacing: 0.0125em;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  font-weight: 600;
  font-size: 15px;
  line-height: 24px;
  align-items: center;
`;

export const ToggleButton = styled(Button)`
  top: ${({ $top = 0 }) => `${$top}px`};
  left: ${(props) => (props.$currentMenu ? '410px' : '20px')};
  position: absolute;

  margin-top: 10px;

  transition: transform 0.3s ease;

  background-color: var(--button-primary-bg);
  border: none;
  color: #ffffff;
  border-radius: 5px;
  padding: 3px 10px;
  z-index: 1001;

  &:hover {
    background-color: var(--button-primary-hover-bg);
    color: #ffffff;
    border: none;
    box-shadow: none;
  }
`;

export const Switch = styled(Form.Switch)`
  .form-check-input {
    width: 34px;
    height: 18px;
    cursor: pointer;
    background-color: var(--switch-inactive);
    // border-color: var(--ascend-text);
    border-radius: 999px;
    // border: none;
    box-shadow: none;
  }

  .form-check-input:checked {
    background-color: var(--switch-active);
    border-color: var(--switch-inactive);

  }

  .form-check-input:focus {
    box-shadow: none;
    border-color: var(--switch-inactive);
  }
`;

export const Content = styled.div`
  padding: 12px;
  border-block-end: 1px solid var(--panel-border-color);

  &:first-of-type {
    border-bottom: none;
  }

  a {
    color: var(--link-color);
  }
`;

export const MapContainer = styled.div`
  flex: 1 1 100%;
  order: 1;
  width: 100%;
  overflow-y: hidden;
  height: 100%;

  .maplibregl-popup-content {
    padding: 0px;
  }
`;

export const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

export const FieldsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
  row-gap: 8px;
`;

export const FieldBlock = styled.div``;

export const FieldLabel = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-text);
`;

export const FieldValue = styled.div`
  font-size: 12px;
  font-weight: 500;
`;

export const SearchBarWrapper = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 400px;
  padding: 6px 10px;
  border-radius: 6px;
  background-color: var(--search-bg);
  box-sizing: border-box;
  border: 1px solid var(--search-border);
`;

export const SearchIcon = styled(FiSearch)`
  flex-shrink: 0;
  margin-right: 8px;
  color: var(--muted-text);
  font-size: 16px;
`;

export const SearchInput = styled.input`
  border: none;
  outline: none;
  width: 500px;
  font-size: 14px;
  background: transparent;
  color: var(--search-text);

  &::placeholder {
    color: var(--search-placeholder);
  }
`;

export const ViewContainer = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;
