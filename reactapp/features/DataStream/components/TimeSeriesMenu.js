import React, { Fragment } from 'react';
import { GoGraph  } from "react-icons/go";
import { IoMdClose } from "react-icons/io";
import { ToggleButton } from './StyledComponents/ts'


const TimeSeriesMenu = ({
  toggleSingleRow,
  currentMenu,
  singleRowOn
}) => {
    
  return (
    <Fragment>
        <ToggleButton $currentMenu={currentMenu} $top={150}  onClick={() => toggleSingleRow(prev => !prev)}>
          {singleRowOn ? <GoGraph size={15} /> : <IoMdClose size={15} />}
        </ToggleButton>
    </Fragment>

  );
};

export default TimeSeriesMenu;