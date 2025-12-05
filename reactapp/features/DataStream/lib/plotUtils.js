
import React from 'react';
import { MdLocationPin } from "react-icons/md";


export const ChartHeader = ({ title }) =>(
  <g transform="translate(12, 24)">
    <MdLocationPin size={18} color="#009989" />
    <text
      x={24}
      y={12}
      fontSize={14}
      fontWeight={600}
      fill="#e5e7eb"
    >
      {title}
    </text>
  </g>
);



