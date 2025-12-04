import styled from 'styled-components';
import { Button } from 'react-bootstrap';

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
`

