
import React from 'react';
import { MdLocationPin, MdClose } from "react-icons/md";
import { Row, IconLabel, SButton } from './styles/styles';

export const ChartHeader = ({ title, onClick }) =>(
  <div style={{ paddingLeft: '16px', paddingRight: '16px' }}>
    <Row>
      <IconLabel $fontSize={16}>
        <MdLocationPin size={18} color="#009989" />
        {title}
      </IconLabel>
      <SButton onClick={onClick}>
        <MdClose/>
      </SButton>
    </Row>
  </div>
);



