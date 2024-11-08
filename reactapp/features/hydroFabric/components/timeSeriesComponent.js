// timeSeriesComponent.js
import React, { useMemo } from 'react';
import { LinePath } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { scaleTime, scaleLinear } from '@visx/scale';
import { extent, max } from 'd3-array';
import { curveMonotoneX } from '@visx/curve';
import { ParentSize } from '@visx/responsive';
import { useHydroFabricContext } from '../hooks/useHydroFabricContext';

const HydroFabricLinePlot = ({ singleRowOn }) => {
  const { state } = useHydroFabricContext();

  // If singleRowOn is true, do not render the chart
  if (singleRowOn) {
    return null;
  }

  // Return null if no data is available
  if (!state.chart.series || state.chart.series.length === 0) {
    return null;
  }

  // Determine if state.chart.series is an array of data points or an array of series
  const isMultiSeries = Array.isArray(state.chart.series[0]?.data);

  // Prepare data for plotting
  const dataSeries = useMemo(() => {
    if (!state.chart.series || state.chart.series.length === 0) {
      return [];
    }
    if (isMultiSeries) {
      // state.chart.series is an array of series objects with 'data' property
      return state.chart.series.map((series, index) => ({
        name: series.name || `Series ${index + 1}`,
        data: series.data.map(point => ({
          x: new Date(point.x),
          y: point.y,
        })),
      }));
    } else {
      // state.chart.series is an array of data points directly
      return [
        {
          name: 'Series 1',
          data: state.chart.series.map(point => ({
            x: new Date(point.x),
            y: point.y,
          })),
        },
      ];
    }
  }, [state.chart.series, isMultiSeries]);

  // Flatten all data points to compute scales
  const allData = useMemo(() => {
    return dataSeries.reduce((acc, series) => acc.concat(series.data), []);
  }, [dataSeries]);

  // Return null if no data is available
  if (allData.length === 0) {
    return null;
  }

  // Define colors for multiple series
  const colors = ['steelblue', 'orange', 'green', 'red', 'purple', 'brown', 'pink'];

  return (
    <div style={{ flex: 1 }}>
      <ParentSize>
        {({ width, height }) => {
          // Define margins and dimensions
          const margin = { top: 20, right: 20, bottom: 50, left: 60 };
          const innerWidth = width - margin.left - margin.right;
          const innerHeight = height - margin.top - margin.bottom;

          // Define scales
          const xScale = scaleTime({
            domain: extent(allData, d => d.x),
            range: [0, innerWidth],
          });

          const yScale = scaleLinear({
            domain: [0, max(allData, d => d.y) || 1],
            range: [innerHeight, 0],
            nice: true,
          });

          return (
            <svg width={width} height={height}>
              <g transform={`translate(${margin.left}, ${margin.top})`}>
                {/* Line Paths */}
                {dataSeries.map((series, index) => (
                  <LinePath
                    key={index}
                    data={series.data}
                    x={d => xScale(d.x)}
                    y={d => yScale(d.y)}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    curve={curveMonotoneX}
                  />
                ))}

                {/* Axes */}
                <AxisBottom
                  top={innerHeight}
                  scale={xScale}
                  numTicks={width > 600 ? 10 : 5}
                  tickFormat={date => date.toLocaleDateString()}
                  tickLabelProps={() => ({
                    fill: 'black',
                    fontSize: 10,
                    textAnchor: 'middle',
                  })}
                  tickStroke="black"
                  stroke="black"
                />
                <AxisLeft
                  scale={yScale}
                  numTicks={5}
                  tickLabelProps={() => ({
                    fill: 'black',
                    fontSize: 10,
                    textAnchor: 'end',
                    dy: '0.33em',
                  })}
                  tickStroke="black"
                  stroke="black"
                />
              </g>
            </svg>
          );
        }}
      </ParentSize>
    </div>
  );
};

export default HydroFabricLinePlot;
