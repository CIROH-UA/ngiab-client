import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import ModelRunsSelect from 'features/ModelRuns/components/modelRunsSelect';
import TimeSeriesSelection from 'features/ModelRuns/components/timeSeriesSelect';
import HydrofabricMapControl from 'features/hydroFabric/components/hydrofabricMapControl';
import { useModelRunsContext } from '../hooks/useModelRunsContext';
import { FaBars, FaTimes } from "react-icons/fa";
import Button from 'react-bootstrap/Button';

const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: ${({ singleRowOn }) => (singleRowOn ? '100vh' : '60%')};
  width: 20%;
  background-color: #4f5b679e;
  color: #cafeff;
  z-index: 1000;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s ease;
  
  /* When closed, shift left so that only 40px remains visible */
  transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100%))'};

  /* Responsive adjustments for different screen sizes */
  @media (max-width: 1366px) {
    width: 25%;
  }
  
  @media (max-width: 1024px) {
    width: 30%;
  }
  
  @media (max-width: 768px) {
    width: 85%;
    height: 100vh;
    transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(-100%)'};
  }
  
  @media (max-width: 480px) {
    width: 90%;
    height: 100vh;
  }
`;

const ToggleButton = styled(Button)`
  position: absolute;
  top: 70px;
  left: ${({ isOpen }) => isOpen ? 'calc(20% - 55px)' : '15px'};
  background-color: #2e646f;
  border: none;
  color: white;
  border-radius: 5px;
  padding: 8px 12px;
  z-index: 1001;

  &:hover, &:focus, &:active{
    background-color:#2e646f;
  }
  
  /* Adjust position for different screen sizes */
  @media (max-width: 1366px) {
    left: ${({ isOpen }) => isOpen ? 'calc(25% - 48px)' : '32px'};
  }
  
  @media (max-width: 1024px) {
    left: ${({ isOpen }) => isOpen ? 'calc(30% - 55px)' : '32px'};
  }
  
  @media (max-width: 768px) {
    top: 20px;
    left: 20px;
    z-index: 1002;
  }
  
  @media (max-width: 480px) {
    top: 15px;
    left: ${({ isOpen }) => isOpen ? 'calc(100% - 55px)' : '15px'};
    padding: 6px 10px;
  }
`;

// Content inside the panel.
const Content = styled.div`
  padding: 15px;
  /* Push content down so close button overlaps top of first section */
  margin-top: 100px;
  height: calc(100% - 100px);
  overflow-y: auto;
  
  /* Reduce padding for smaller screens */
  @media (max-width: 1366px) {
    padding: 12px;
    margin-top: 110px;
    height: calc(100% - 110px);
  }
  
  @media (max-width: 1024px) {
    padding: 10px;
    margin-top: 100px;
    height: calc(100% - 100px);
  }
  
  @media (max-width: 768px) {
    padding: 8px;
    margin-top: 90px;
    height: calc(100% - 90px);
  }
  
  @media (max-width: 480px) {
    padding: 6px;
    margin-top: 80px;
    height: calc(100% - 80px);
  }
`;

const ModelRunsSection = styled.div`
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 15px;
  margin-bottom: 15px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(5px);
  flex: 1;
  
  /* Reduce padding for smaller screens */
  @media (max-width: 1366px) {
    padding: 12px;
    margin-bottom: 12px;
  }
  
  @media (max-width: 1024px) {
    padding: 10px;
    margin-bottom: 10px;
  }
`;

const FlexContainer = styled.div`
  display: block; /* Remove flex to let sections take full width */
  margin-bottom: 15px;
  
  /* Reduce margin for smaller screens */
  @media (max-width: 1366px) {
    margin-bottom: 12px;
  }
  
  @media (max-width: 1024px) {
    margin-bottom: 10px;
  }
`;

const SectionTitle = styled.h5`
  color: #ffffff !important;
  font-weight: 500;
  font-size: 1rem;
  margin-bottom: 12px;
  text-align: center;
  letter-spacing: 0.5px;
  position: relative;
  
  /* Reduce font size for smaller screens */
  @media (max-width: 1366px) {
    font-size: 0.9rem;
    margin-bottom: 10px;
  }
  
  @media (max-width: 1024px) {
    font-size: 0.85rem;
    margin-bottom: 8px;
  }
  
  &::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 2px;
    background: linear-gradient(135deg, #ffffff 0%, #cafeff 100%);
    border-radius: 1px;
  }
`;

const DropdownContainer = styled.div`
  margin-bottom: 12px;
  
  /* Reduce margin for smaller screens */
  @media (max-width: 1366px) {
    margin-bottom: 10px;
  }
  
  @media (max-width: 1024px) {
    margin-bottom: 8px;
  }
  
  .select__control {
    background: rgba(255, 255, 255, 0.1) !important;
    border: 1px solid rgba(255, 255, 255, 0.2) !important;
    border-radius: 8px !important;
    box-shadow: none !important;
    min-height: 36px !important;
    
    /* Reduce height for smaller screens */
    @media (max-width: 1366px) {
      min-height: 32px !important;
    }
    
    @media (max-width: 1024px) {
      min-height: 30px !important;
    }
    
    &:hover {
      border-color: rgba(255, 255, 255, 0.3) !important;
    }
    
    &.select__control--is-focused {
      border-color: #cafeff !important;
      box-shadow: 0 0 0 1px #cafeff !important;
    }
  }
  
  .select__single-value {
    color: #ffffff !important;
    font-weight: 400 !important;
    font-size: 0.9rem !important;
    
    @media (max-width: 1366px) {
      font-size: 0.85rem !important;
    }
    
    @media (max-width: 1024px) {
      font-size: 0.8rem !important;
    }
  }
  
  .select__placeholder {
    color: rgba(255, 255, 255, 0.6) !important;
    font-size: 0.9rem !important;
    
    @media (max-width: 1366px) {
      font-size: 0.85rem !important;
    }
    
    @media (max-width: 1024px) {
      font-size: 0.8rem !important;
    }
  }
  
  .select__indicator {
    color: #ffffff !important;
    
    &:hover {
      color: #cafeff !important;
    }
  }
  
  .select__menu {
    background: #4f5b67 !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 8px !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2) !important;
  }
  
  .select__option {
    background: #4f5b67 !important;
    color: #ffffff !important;
    padding: 8px 12px !important;
    font-size: 0.9rem !important;
    
    @media (max-width: 1366px) {
      padding: 6px 10px !important;
      font-size: 0.85rem !important;
    }
    
    @media (max-width: 1024px) {
      padding: 5px 8px !important;
      font-size: 0.8rem !important;
    }
    
    &:hover {
      background: rgba(255, 255, 255, 0.1) !important;
    }
    
    &.select__option--is-focused {
      background: rgba(255, 255, 255, 0.15) !important;
    }
    
    &.select__option--is-selected {
      background: rgba(202, 254, 255, 0.2) !important;
      color: #cafeff !important;
    }
  }
`;

const ModelRunsView = ({
  singleRowOn,
  toggleSingleRow,
  setIsLoading,
  setIsModelRunListOpen,
}) => {
  
  const [isOpen, setIsOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth > 768 : true));
  const [isModelRunListVisible, setIsModelRunListVisible] = useState(true);
  const { state } = useModelRunsContext();
  const isVisible = state.base_model_id ? true : false;

  const toggleContainer = () => {
    setIsOpen(prev => !prev);
    setIsModelRunListOpen(prev => !prev);
  };

  return (
    <Fragment>
      <ToggleButton onClick={toggleContainer} isOpen={isOpen}>
        {isOpen ? <FaTimes size={14} /> : <FaBars size={14} />}
      </ToggleButton>

      <Container isOpen={isOpen}>
        <Content>
          {
            isModelRunListVisible &&(
              <Fragment>
                <FlexContainer>
                  <ModelRunsSection>
                    <SectionTitle>Model Runs</SectionTitle>
                    <DropdownContainer>
                      <ModelRunsSelect />
                    </DropdownContainer>
                  </ModelRunsSection>
                  {/* Removed spacer; sections stack full width */}
                </FlexContainer>
                
                <TimeSeriesSelection
                    singleRowOn={singleRowOn}
                    toggleSingleRow={toggleSingleRow}
                    setIsLoading={setIsLoading}
                />
                <HydrofabricMapControl
                    isVisible={isVisible}
                />
              </Fragment>
            )
          }
        </Content>
      </Container>
    </Fragment>
  );
};

export default ModelRunsView;