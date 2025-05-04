import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import BucketNamesSelect from './bucketNamesSelect';
import Button from 'react-bootstrap/Button';
import { FaList } from "react-icons/fa";
import { IoMdClose } from "react-icons/io";

const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  width: 20%;
  background-color: #4f5b67;

  
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

// const TogggledButton = styled(Button)`
//   top: ${({ isOpen }) => isOpen ? '80px;' : '100px;'};
//   left: ${({ isOpen }) => isOpen ? '18%;' : '25px;'};
//   position: absolute;
  
//   margin-top: 10px;

//   // transform: translate(-50%, -50%);
//   transition: transform 0.3s ease;
//   // transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-90%))'};

//   background-color: rgba(255, 255, 255, 0.1);
//   border: none;
//   color: white;
//   border-radius: 5px;
//   padding: 7px 8px;
//   z-index: 1001;

//   &:hover, &:focus {
//     background-color: rgba(0, 0, 0, 0.1)!important;
//     color: white;
//     border: none;
//     box-shadow: none;
//   }
// `;

const TogggledButton = styled(Button)`
  top: 80px;
  // left: 25px;
  left: ${({ currentMenu }) => currentMenu ? '21%' : '20px'};
  position: absolute;
  
  margin-top: 10px;

  // transform: translate(-50%, -50%);
  transition: transform 0.3s ease;
  // transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-90%))'};

  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  border-radius: 5px;
  padding: 7px 8px;
  z-index: 1001;

  &:hover, &:focus {
    background-color: rgba(0, 0, 0, 0.1)!important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

const Content = styled.div`
  padding: 16px;
  margin-top: 100px;
`;



const DataStreamMenu = ({
  isopen,
  // setIsOpen,
  handleIsOpen,
  currentMenu
}) => {
  // const [isOpen, setIsOpen] = useState(false);
  
  // const toggleContainer = () => {
  //   // setIsOpen(prev => !prev);
  //   handleClose();
  //   // setIsOpen();
  // };


  
  return (
    <Fragment>
          
          {
            !isopen && <TogggledButton onClick={handleIsOpen} currentMenu={currentMenu} >
               <FaList size={20} />
            </TogggledButton>
          }
          <Container isOpen={isopen}>
            <Content>
              <h3>NGIAB DataStream S3 Data</h3>

              <BucketNamesSelect />
            </Content>
          </Container>
    </Fragment>

  );
};

export default DataStreamMenu;