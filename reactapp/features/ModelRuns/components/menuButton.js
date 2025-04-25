import React from 'react';
import { Button } from 'react-bootstrap';
import { FaPlus , FaCoffee, FaBolt } from 'react-icons/fa';
import styled from 'styled-components';

const CenteredContainer = styled.div`
  position: absolute;
  top: 40%;
  right: 0px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

const ButtonGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 10px;
`;

const StyledButton = styled(Button)`
  
  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  border-radius: 2px;
  padding: 7px 8px;
  z-index: 1001;

  &:hover, &:focus {
    background-color: rgba(0, 0, 0, 0.1)!important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

const CenteredButtons = (
    {
        showImportModelRunForm
    }) => {
  return (
    <CenteredContainer>
      <ButtonGroup>
        <StyledButton onClick={showImportModelRunForm}>
            <FaPlus  size={20} />
        </StyledButton>
      </ButtonGroup>
    </CenteredContainer>
  );
};

export default CenteredButtons;