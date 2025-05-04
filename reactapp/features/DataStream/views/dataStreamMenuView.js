import React, { Fragment, useState } from 'react';
import DataStreamMenuWrapper from 'features/DataStream/components/dataStreamMenuWrapper';


const DataStreamMenuView = ({
  toggleSingleRow,
  setIsLoading,
  setIsDataStreamMenuOpen,
  
}) => {
  
  return (
    <Fragment>
      <DataStreamMenuWrapper 
          toggleSingleRow={toggleSingleRow}
          setIsLoading={setIsLoading}
          setIsDataStreamMenuOpen={setIsDataStreamMenuOpen} 
      />
    </Fragment>

  );
};

export default DataStreamMenuView;