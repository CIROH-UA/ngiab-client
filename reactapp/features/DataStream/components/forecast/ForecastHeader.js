
import React,{ useState } from 'react';
import { MdLocationPin, MdClose, MdInfoOutline } from "react-icons/md";
import { Row, IconLabel, SButton } from '../styles/Styles';
import { DataInfoModel } from '../Modals';


export const ForecastHeader = ({ title, onClick }) =>{
  const [ modalDataInfoShow, setModalDataInfoShow ] = useState(false);
  return (
    <div>
      <Row>
        <IconLabel $fontSize={16}>
          <MdLocationPin size={18} color="#009989" />
          {title}
          <IconLabel>
            <SButton bsPrefix='btn2' onClick={() => setModalDataInfoShow(true)}>
              <MdInfoOutline size={15} />
            </SButton>
          </IconLabel> 
        </IconLabel>
        <SButton onClick={onClick}>
          <MdClose/>
        </SButton>
      </Row>
      <DataInfoModel
        show={modalDataInfoShow}
        onHide={() => setModalDataInfoShow(false)}
      />
    </div>
)};



