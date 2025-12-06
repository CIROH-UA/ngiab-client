import React, { Fragment, useState } from 'react';
import DataStream from 'features/DataStream/old/components/dataStream';


const DataStreamMenuView = ({
  toggleSingleRow,
  setIsLoading,
  setIsDataStreamMenuOpen,
  singleRowOn
  
}) => {
  
  return (
    <Fragment>
      <DataStream 
          toggleSingleRow={toggleSingleRow}
          setIsLoading={setIsLoading}
          setIsDataStreamMenuOpen={setIsDataStreamMenuOpen}
          singleRowOn={singleRowOn}
      />
    </Fragment>

  );
};

export default DataStreamMenuView;