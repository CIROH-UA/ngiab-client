import React, { Fragment, useState } from 'react';
import DataStreamMenuWrapper from 'features/DataStream/components/dataStreamMenuWrapper';


const DataStreamMenuView = ({
  toggleSingleRow,
  setIsLoading,
  setIsDataStreamMenuOpen,
  singleRowOn
  
}) => {
  
  return (
    <Fragment>
      <DataStreamMenuWrapper 
          toggleSingleRow={toggleSingleRow}
          setIsLoading={setIsLoading}
          setIsDataStreamMenuOpen={setIsDataStreamMenuOpen}
          singleRowOn={singleRowOn}
      />
    </Fragment>

  );
};

export default DataStreamMenuView;