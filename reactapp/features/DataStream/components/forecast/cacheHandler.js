// ResetDataButton.js
import React, { useState } from 'react';
import { XButton } from '../styles/Styles';
import { dropAllVpuDataTables } from 'features/DataStream/lib/queryData';
import { resetDatabase } from 'features/DataStream/lib/duckdbClient';
import { DeleteDataIcon } from 'features/DataStream/lib/layers';
const ResetDataButton = () => {
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState(null);

  const handleResetClick = async () => {
    const confirmed = window.confirm(
      'This will drop all VPU data tables and reset the in-memory DuckDB database.\n\n' +
      'The index_data_table will be preserved.\n\n' +
      'Do you want to continue?'
    );

    if (!confirmed) return;

    setIsResetting(true);
    setError(null);

    try {
      await dropAllVpuDataTables();
      await resetDatabase();
      console.log('Data reset complete.');
    } catch (err) {
      console.error('Error while resetting data:', err);
      setError('Failed to reset data. Check the console for details.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <XButton
        variant="outline-danger"
        size="sm"
        onClick={handleResetClick}
        disabled={isResetting}
      >
        {isResetting ? 'Resetting…' :  <DeleteDataIcon style={{ marginRight: 6 }} />}
      </XButton>

      {error && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--danger-color, #dc2626)',
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
};

export default ResetDataButton;
