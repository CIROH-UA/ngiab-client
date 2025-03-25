import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import ModelRunsSelect from 'features/ModelRuns/components/modelRunsSelect';
// The main container for the panel.
// It has absolute positioning, a responsive width, and a CSS transition for sliding.
const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  width: 30%;
  background-color: #2c3e50;
  z-index: 1000;
  transition: transform 0.3s ease;
  /* When closed, shift left so that only 40px remains visible */
  transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100% + 40px))'};

  /* On small screens, use 100% width */
  @media (max-width: 768px) {
    width: 100%;
    transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100% + 40px))'};
  }
`;

// The toggle button is positioned on the left edge of the panel.
// When open, it shows a '<' icon; when closed, it shows a '>' icon.
const ToggleButton = styled.button`
  position: absolute;
  top: 80px;
  left: 25px;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 40px;
  background-color: rgba(255,255,255,0.1);
  border: none;
  color: #fff;
  font-size: 1.5rem;
  cursor: pointer;
  border-radius: 4px;
  z-index: 1001;
`;

// Content inside the panel.
const Content = styled.div`
  padding: 16px;
  margin-top: 100px;
`;

const ModelRunsView = () => {
  const [isOpen, setIsOpen] = useState(true);

  const toggleContainer = () => {
    setIsOpen(prev => !prev);
  };

  return (
    <Fragment>
    <ToggleButton onClick={toggleContainer}>
    {isOpen ? '<' : '>'}
  </ToggleButton>
    <Container isOpen={isOpen}>

      <Content>
        <h2>Model Runs</h2>
        <p>This is your model runs container content.</p>
        <ModelRunsSelect />

      </Content>
    </Container>

    </Fragment>

  );
};

export default ModelRunsView;