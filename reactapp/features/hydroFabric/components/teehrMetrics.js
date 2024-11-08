import React from 'react';
import DataTable from 'react-data-table-component';

const TeehrMetricsTable = ({ data }) => {
    // Define the columns based on the configuration names in the data
    const columns = [
        { name: 'Metric', selector: row => row.metric, sortable: true },
        ...Object.keys(data[0]).filter(key => key !== 'metric').map(configName => ({
            name: configName,
            selector: row => row[configName],
            sortable: true,
        }))
    ];

    return (
        <DataTable
            title="Teehr Metrics"
            columns={columns}
            data={data}
            defaultSortField="metric"
            pagination
        />
    );
};

export default TeehrMetricsTable;