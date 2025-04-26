import React, { Fragment, useState } from 'react';
import styled from 'styled-components';
import BucketNamesSelect from './bucketNamesSelect';


const DataStreamMenu = () => {
  
  return (
    <Fragment>
          <h3>NGIAB DataStream S3 Data</h3>
          <BucketNamesSelect />
    </Fragment>

  );
};

export default DataStreamMenu;