import React, { Fragment } from 'react';
import styled from 'styled-components';
import BucketSelect from './ts_select';
import Button from 'react-bootstrap/Button';
import { FaList,  } from "react-icons/fa";
import { MdSsidChart,MdInfoOutline  } from "react-icons/md";


const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  width: 400px;
  padding: 20px;
  background-color: #4f5b679e;
  color: #fff;
  z-index: 1000;
  transition: transform 0.3s ease;
  /* When closed, shift left so that only 40px remains visible */
  transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100% ))'};

  /* On small screens, use 100% width */
  @media (max-width: 768px) {
    width: 100%;
    transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100%))'};
  }
`;

const Title = styled.span`
    letter-spacing: .0125em;
    font-family: "Google Sans", Roboto, Arial, sans-serif;
    font-weight: 500;
    font-size: 16px;
    line-height: 24px;
    align-items: center;
    color: #dfd4d4ff;
`
const IconLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
`
const Block = styled.div`
  border: none;
  border-top: 1px solid #ffffff33;
  margin: 10px 0;
`;

const TogggledButton = styled(Button)`
  top: 80px;
  // left: 25px;
  left: ${({ currentMenu }) => currentMenu ? '21%' : '20px'};
  position: absolute;
  
  margin-top: 10px;

  // transform: translate(-50%, -50%);
  transition: transform 0.3s ease;
  // transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-90%))'};

  background-color: #009989;
  border: none; 
  color: white;
  border-radius: 5px;
  padding: 3px 10px;
  z-index: 1001;

  &:hover, &:focus {
    background-color: #000000b3 !important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

const Content = styled.div`
  padding: 16px;
  margin-top: 100px;
  border-block: 1px solid rgb(218, 220, 224);
  padding-block-start: 8px;
  a {
    color: white;
  }
`;

const DataStreamMenu = ({
  isopen,
  handleIsOpen,
  currentMenu
}) => {

  return (
    <Fragment>
          
          {
            !isopen && 
              <TogggledButton onClick={handleIsOpen} currentMenu={currentMenu} >
                <FaList size={15} />
              </TogggledButton> 
          }
          <Container isOpen={isopen}>
            <Content>
              <IconLabel>
                <MdSsidChart />
                <Title>
                  Data Options
                </Title>
                <MdInfoOutline  />
              </IconLabel>
              
              <BucketSelect />

            </Content>

            
          </Container>
    </Fragment>

  );
};

export default DataStreamMenu;