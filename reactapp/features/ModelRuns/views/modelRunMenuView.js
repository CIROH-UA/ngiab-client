import React, { Fragment, useState } from 'react';
import NgenMenuWrapper from 'features/ngen/components/ngenMenus';
import ModelRunsSelect from '../components/modelRunsSelect';

const ModelRunMenuView = ({
  toggleSingleRow,
  setIsLoading,
  setIsMenuOpen,
  singleRowOn
}) => {
  
  return (
    <Fragment>
      <NgenMenuWrapper 
          toggleSingleRow={toggleSingleRow}
          setIsLoading={setIsLoading}
          setIsNgenMenuOpen={setIsMenuOpen}
          singleRowOn={singleRowOn}
          MenuComponent={ModelRunsSelect}
      />
    </Fragment>

  );
};

export default ModelRunMenuView;