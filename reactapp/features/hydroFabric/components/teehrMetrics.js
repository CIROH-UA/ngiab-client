import React from 'react';
import DataTable from 'react-data-table-component';
import useTheme from '../../../hooks/useTheme'; // Adjust the import path as needed

const TeehrMetricsTable = ({ data }) => {
    const theme = useTheme();

    const customStyles = {
        header: {
            style: {
                backgroundColor: theme === 'dark' ? '#2c3e50' : '#ffffff',
                color: theme === 'dark' ? '#ffffff' : '#000000',
                fontSize: '16px',
                fontWeight: 'bold',
                borderBottomColor: '#d1d5db',
            },
        },
        headRow: {
            style: {
                backgroundColor: theme === 'dark' ? '#2c3e50' : '#f0f0f0',
                color: theme === 'dark' ? '#ffffff' : '#000000',
                borderBottomColor: '#d1d5db',
            },
        },
        rows: {
            style: {
                backgroundColor: theme === 'dark' ? '#4f5b67' : '#4f5b67',
                '&:nth-of-type(odd)': {
                    backgroundColor: theme === 'dark' ? '#4f5b67' : '#4f5b67',
                },
            },
            highlightOnHoverStyle: {
                backgroundColor: '#7c8895',
                color: '#fff',
                transitionDuration: '0.15s',
                transitionProperty: 'background-color, color',
            },
        },
        cells: {
            style: {
                color: theme === 'dark' ? '#e0e0e0' : '#333333',
                fontSize: '14px',
            },
        },
        pagination: {
            style: {
                backgroundColor: theme === 'dark' ? '#2c3e50' : '#ffffff',
                color: theme === 'dark' ? '#ffffff' : '#000000',
            },
        },
    };

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
            customStyles={customStyles}
        />
    );
};

export default TeehrMetricsTable;
