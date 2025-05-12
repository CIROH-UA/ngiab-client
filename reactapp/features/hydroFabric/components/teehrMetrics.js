import React from 'react';
import DataTable, {createTheme } from 'react-data-table-component';
import useTheme from '../../../hooks/useTheme'; // Adjust the import path as needed


const BRAND_LIGHT_BG = '#f0f0f0';
const BRAND_DARK_BG  = '#4f5b67';
const ROW_HOVER      = '#7c8895';
const BORDER         = '#d1d5db';

// Friendly names so the component code stays readable
export const LIGHT_TABLE = 'lightTable';
export const DARK_TABLE  = 'darkTable';

/* --------  Light theme  -------- */
createTheme(
  LIGHT_TABLE,
  {
    text: {
      primary:   '#000000',
      secondary: '#333333',
    },
    background: {
      default:   BRAND_LIGHT_BG,        // table & header background
    },
    divider: {
      default:   BORDER,                // header + row dividers
    },
    striped: {
      default:   BRAND_LIGHT_BG,        // odd rows
      text:      '#000000',
    },
    highlightOnHover: {
      default:   ROW_HOVER,
      text:      '#ffffff',
    },
    button: {
      default:   '#000000',             // pagination buttons
      hover:     ROW_HOVER,
      focus:     ROW_HOVER,
    },
  },
  'light'
);

/* --------  Dark theme  -------- */
createTheme(
  DARK_TABLE,
  {
    text: {
      primary:   '#ffffff',
      secondary: '#e0e0e0',
    },
    background: {
      default:   BRAND_DARK_BG,
    },
    divider: {
      default:   BORDER,
    },
    striped: {
      default:   BRAND_DARK_BG,
      text:      '#ffffff',
    },
    highlightOnHover: {
      default:   ROW_HOVER,
      text:      '#ffffff',
    },
    button: {
      default:   '#ffffff',
      hover:     ROW_HOVER,
      focus:     ROW_HOVER,
    },
  },
  'dark'
);



const TeehrMetricsTable = ({ data }) => {
    const theme = useTheme();
    const tableTheme = theme === 'dark' ? DARK_TABLE : LIGHT_TABLE;

    const columns = [
        { name: 'Metric', selector: row => row.metric, sortable: true },
        ...(data.length > 0
            ? Object.keys(data[0])
                  .filter(key => key !== 'metric')
                  .map(configName => ({
                      name: configName,
                      selector: row => row[configName],
                      sortable: true,
                  }))
            : []),
    ];

    return (
        <DataTable
            columns={columns}
            data={data}
            defaultSortField="metric"
            pagination
            theme={tableTheme}
        />
    );
};

export default TeehrMetricsTable;
