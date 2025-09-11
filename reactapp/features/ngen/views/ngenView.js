import React, { Fragment, useState } from 'react';
import NgenMenuWrapper from 'features/ngen/components/ngenMenus';


const NgenMenuView = ({
  toggleSingleRow,
  setIsLoading,
  setIsNgenMenuOpen,
  singleRowOn,
  MenuComponent
}) => {
  
  return (
    <Fragment>
      <NgenMenuWrapper 
          toggleSingleRow={toggleSingleRow}
          setIsLoading={setIsLoading}
          setIsNgenMenuOpen={setIsNgenMenuOpen}
          singleRowOn={singleRowOn}
          MenuComponent={MenuComponent}
      />
    </Fragment>

  );
};

export default NgenMenuView;