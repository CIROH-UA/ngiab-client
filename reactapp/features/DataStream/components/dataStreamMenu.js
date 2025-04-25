import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import BucketNamesSelect from './bucketNamesSelect';
const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  width: 100%;
  background-color: #4f5b67;

  visibility: ${({ isVisible }) => (isVisible ? 'visible' : 'hidden')};
  z-index: 1000;
`;



// Content inside the panel.
const Content = styled.div`
  padding: 16px;
  margin-top: 100px;
`;

const DataStreamMenu = ({
    isVisible
}) => {
  
  return (
    <Fragment>    
      <Container isVisible={isVisible}>
        <Content>
          <h3>NGIAB DataStream S3 Data</h3>
          <BucketNamesSelect />
        </Content>
      </Container>
    </Fragment>

  );
};

export default DataStreamMenu;