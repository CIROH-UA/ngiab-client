
import React, { Fragment } from 'react';
import { MdLocationPin } from "react-icons/md";
import { Row, IconLabel } from '../components/styles/styles';

export const ChartHeader = ({ title }) =>(
  <div style={{ paddingLeft: '16px' }}>
    <Row>
      <IconLabel $fontSize={16}>
        <MdLocationPin size={18} color="#009989" />
        {title}
      </IconLabel>
    </Row>
  </div>
);



