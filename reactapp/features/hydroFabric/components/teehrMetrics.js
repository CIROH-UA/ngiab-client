import React from 'react';
import DataTable from 'react-data-table-component';

const customStyles = {
    header: {
        style: {
            backgroundColor: '#2c3e50', // Dark header background
            color: '#ffffff',           // White text for header
            fontSize: '16px',
            fontWeight: 'bold',
            borderBottomColor: '#d1d5db'
        },
    },
    headRow: {
        style: {
            backgroundColor: '#2c3e50', // Dark header row background
            color: '#ffffff',           // White text for header row
            borderBottomColor: '#d1d5db', // Light border color
        },
    },
    rows: {
        style: {
            backgroundColor: '#ffffff', // Default row background
            '&:nth-of-type(odd)': {
                backgroundColor: '#f9f9f9', // Alternate row background
            },
        },
        highlightOnHoverStyle: {
            backgroundColor: '#f5f5f5',
            color: '#333333',
            transitionDuration: '0.15s',
            transitionProperty: 'background-color, color',
        },
    },
    cells: {
        style: {
            color: '#333333',           // Dark gray text for cells
            fontSize: '14px',
        },
    },
    pagination: {
        style: {
            backgroundColor: '#2c3e50', // Dark pagination background
            color: '#ffffff',           // White text for pagination
        },
    },
};

const TeehrMetricsTable = ({ data }) => {
    // const [theme, setTheme] = useState('light');


    const columns = [
        { name: 'Metric', selector: row => row.metric, sortable: true },
        ...(data.length > 0 ? Object.keys(data[0]).filter(key => key !== 'metric').map(configName => ({
            name: configName,
            selector: row => row[configName],
            sortable: true,
        })) : [])
    ];

    return (
        <DataTable
            title="Teehr Metrics"
            columns={columns}
            data={data}
            defaultSortField="metric"
            pagination
            customStyles={customStyles} // Apply custom styles
        />
    );
};

export default TeehrMetricsTable;