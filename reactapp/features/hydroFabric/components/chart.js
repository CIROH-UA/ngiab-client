// LineChart.js
import React, { useCallback } from 'react';
import { Zoom, applyMatrixToPoint } from '@visx/zoom';
import { Group } from '@visx/group';
import { scaleLinear, scaleTime } from '@visx/scale';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { LinePath, Line } from '@visx/shape';
import { extent, bisector } from 'd3-array';
import { GridRows, GridColumns } from '@visx/grid';
import {
  useTooltip,
  TooltipWithBounds,
  defaultStyles,
} from '@visx/tooltip';
import { LuExpand } from "react-icons/lu";
import { localPoint } from '@visx/event';
import { GlyphCircle } from '@visx/glyph';
import { timeParse, timeFormat } from 'd3-time-format';
import { RectClipPath } from '@visx/clip-path';
import { lightTheme, darkTheme } from '@visx/xychart';
import useTheme from 'hooks/useTheme'; // Adjust the import path as needed

function LineChart({ width, height, data, layout }) {
  const theme = useTheme();
  const visxTheme = theme === 'dark' ? darkTheme : lightTheme;
  
  // Tooltip parameters
  const {
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
    showTooltip,
    hideTooltip,
  } = useTooltip();

  // Define margins
  const margin = { top: 40, right: 40, bottom: 40, left: 60 };

  // Inner dimensions
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Parse date string to Date object
  const parseDate = timeParse('%Y-%m-%d %H:%M:%S');

  // Flatten data to get all data points for scales
  const allData = data.flatMap(s => s.data ?? []);
  if (allData.length === 0) {
    /* choose one of the two return paths */
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // color: 'var(--ifm-font-color-base)',
          fontStyle: 'italic',
          fontSize: '1rem',
        }}
      >
         🛠️ No data to display
      </div>
    );
    // return null;        // ← or simply render nothing
  }
  // Data accessors
  const getDate = (d) => parseDate(d.x.trim());
  const getYValue = (d) => d.y;
  const safeExtent = (arr, accessor, fallback = [0, 1]) => {
    const [min, max] = extent(arr, accessor);
    return min == null || max == null ? fallback : [min, max];
  };

  // Define initial scales
  const xScale = scaleTime({
    range: [0, width - 100],            // use your margins
    domain: safeExtent(allData, getDate, [new Date(), new Date()]),
    nice: true,
  });

  const yScale = scaleLinear({
    range: [height - 80, 0],
    domain: safeExtent(allData, getYValue, [0, 1]),
    nice: true,
  });

  // Colors for each series
  const colors =
    theme === 'dark'
      ? ['#43b284', '#ff8c42', '#a566ff', '#20a4f3', '#ffc107']
      : ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd'];

  // Tooltip styles
  const tooltipStyles = {
    ...defaultStyles,
    minWidth: 60,
    backgroundColor:
      theme === 'dark'
        ? 'rgba(44, 62, 80, 0.9)'
        : 'rgba(255, 255, 255, 0.9)',
    color: theme === 'dark' ? 'white' : 'black',
    fontSize: 14,
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)',
  };

  // Date formatter
  const formatDate = timeFormat('%Y-%m-%d');

  // Bisector for finding closest data point
  const bisectDate = bisector((d) => getDate(d)).left;

  // Function to rescale x-axis based on zoom
  const rescaleXAxis = (scale, transformMatrix) => {
    const newDomain = scale
      .range()
      .map((r) =>
        scale.invert(
          (r - transformMatrix.translateX) / transformMatrix.scaleX
        )
      );
    return scale.copy().domain(newDomain);
  };

  // Function to rescale y-axis based on zoom
  const rescaleYAxis = (scale, transformMatrix) => {
    const newDomain = scale
      .range()
      .map((r) =>
        scale.invert(
          (r - transformMatrix.translateY) / transformMatrix.scaleY
        )
      );
    return scale.copy().domain(newDomain);
  };

  // Tooltip handler
  const handleTooltip = useCallback(
    (event, zoom) => {
      const point = localPoint(event) || { x: 0, y: 0 };
      const x = point.x - margin.left;
      const x0 = rescaleXAxis(xScale, zoom.transformMatrix).invert(x);

      const tooltipDataArray = [];

      data.forEach((series, seriesIndex) => {
        const seriesData = series.data;
        const index = bisectDate(seriesData, x0, 1);
        const d0 = seriesData[index - 1];
        const d1 = seriesData[index];
        let d = d0;

        if (d1 && getDate(d1)) {
          d = x0 - getDate(d0) > getDate(d1) - x0 ? d1 : d0;
        }

        tooltipDataArray.push({
          dataPoint: d,
          seriesIndex,
          seriesLabel: series.label,
        });
      });

      // Calculate the tooltip's y-position
      const yPositions = tooltipDataArray.map((d) =>
        rescaleYAxis(yScale, zoom.transformMatrix)(getYValue(d.dataPoint))
      );
      const tooltipTopPosition = Math.min(...yPositions) + margin.top;

      showTooltip({
        tooltipData: tooltipDataArray,
        tooltipLeft: point.x,
        tooltipTop: tooltipTopPosition,
      });
    },
    [
      showTooltip,
      xScale,
      yScale,
      data,
      getDate,
      getYValue,
      bisectDate,
      margin.left,
      margin.top,
    ]
  );

  // Updated constrain function
  const constrain = (transformMatrix) => {
    const { scaleX, scaleY, translateX, translateY } = transformMatrix;

    // Fix constrain scale
    if (scaleX < 1) transformMatrix.scaleX = 1;
    if (scaleY < 1) transformMatrix.scaleY = 1;

    // Fix constrain translate [left, top] position
    if (translateX > 0) transformMatrix.translateX = 0;
    if (translateY > 0) transformMatrix.translateY = 0;

    // Fix constrain translate [right, bottom] position
    const max = applyMatrixToPoint(transformMatrix, {
      x: innerWidth,
      y: innerHeight,
    });
    if (max.x < innerWidth) {
      transformMatrix.translateX += innerWidth - max.x;
    }
    if (max.y < innerHeight) {
      transformMatrix.translateY += innerHeight - max.y;
    }

    // Return the constrained transform matrix
    return transformMatrix;
  };

  return (
    <div style={{ position: 'relative' }}>
      <Zoom
        width={innerWidth}
        height={innerHeight}
        scaleXMin={1}
        scaleXMax={10}
        scaleYMin={1}
        scaleYMax={10}
        initialTransformMatrix={{
          scaleX: 1,
          scaleY: 1,
          translateX: 0,
          translateY: 0,
          skewX: 0,
          skewY: 0,
        }}
        constrain={constrain}
      >
        {(zoom) => {
          // Apply zoom transformations to scales
          const newXScale = rescaleXAxis(xScale, zoom.transformMatrix);
          const newYScale = rescaleYAxis(yScale, zoom.transformMatrix);

          return (
            <>
              {/* Legend and Controls */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 10,
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex' }}>
                  {data.map((series, index) => (
                    <div
                      key={`legend-${index}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        marginRight: 10,
                        padding: '2px 6px',
                        border: '1px solid #ddd',
                        borderRadius: 4,
                        backgroundColor:
                          theme === 'dark' ? '#4f5b67' : '#f0f0f0',
                      }}
                    >
                      <div
                        style={{
                          backgroundColor:
                            colors[index % colors.length],
                          width: 10,
                          height: 10,
                          marginRight: 5,
                        }}
                      />
                      <div
                        style={{
                          color:
                            theme === 'dark' ? '#f0f0f0' : '#000000',
                          fontSize: 14,
                        }}
                      >
                        {series.label}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={zoom.reset}
                  style={{
                    backgroundColor:
                      theme === 'dark' ? '#4f5b67' : '#ffffff',
                    color: theme === 'dark' ? '#ffffff' : '#000000',
                    border: '1px solid #ddd',
                    fontWeight: 'bold',
                    // border: 'none',
                    borderRadius: 4,
                    padding: '4px 8px',
                    cursor: 'pointer',
                  }}
                >
                  <LuExpand size={20} />

                </button>
              </div>

              <svg
                width={width}
                height={height}
                style={{
                  cursor: zoom.isDragging ? 'grabbing' : 'grab',
                }}
              >
                {/* Define a clip path */}
                <RectClipPath
                  id="chart-clip"
                  x={0}
                  y={0}
                  width={innerWidth}
                  height={innerHeight}
                />
                <Group left={margin.left} top={margin.top}>
                  <GridRows
                    scale={newYScale}
                    width={innerWidth}
                    height={innerHeight}
                    stroke={
                      theme === 'dark' ? '#7f8c8d' : '#e0e0e0'
                    }
                    strokeOpacity={0.1}
                    strokeWidth={1}
                  />

                  <GridColumns
                    scale={newXScale}
                    width={innerWidth}
                    height={innerHeight}
                    stroke={
                      theme === 'dark' ? '#7f8c8d' : '#e0e0e0'
                    }
                    strokeOpacity={0.1}
                    strokeWidth={1}
                  />

                  <AxisLeft
                    scale={newYScale}
                    stroke={
                      theme === 'dark' ? '#d1d5db' : '#000000'
                    }
                    tickStroke={
                      theme === 'dark' ? '#d1d5db' : '#000000'
                    }
                    tickLabelProps={() => ({
                      fill:
                        theme === 'dark' ? '#e0e0e0' : '#000000',
                      fontSize: 12,
                      fontWeight: 'bold',
                      textAnchor: 'end',
                    })}
                    // label={layout.yaxis}
                    labelProps={{
                      fill:
                        theme === 'dark' ? '#e0e0e0' : '#000000',
                      fontSize: 14,
                      strokeWidth: 0,
                      paintOrder: 'stroke',
                      fontFamily: 'sans-serif',
                    }}
                  />
                  <AxisBottom
                    scale={newXScale}
                    top={innerHeight}
                    stroke={
                      theme === 'dark' ? '#d1d5db' : '#000000'
                    }
                    tickFormat={formatDate}
                    tickStroke={
                      theme === 'dark' ? '#d1d5db' : '#000000'
                    }
                    tickLabelProps={() => ({
                      fill:
                        theme === 'dark' ? '#e0e0e0' : '#000000',
                      fontSize: 12,
                      fontWeight: 'bold',
                      textAnchor: 'middle',
                    })}
                  />
                  {/* Apply the clip path to the chart elements */}
                  <Group clipPath="url(#chart-clip)">
                    {/* Render multiple lines */}
                    {data.map((series, index) => (
                      <LinePath
                        key={`line-${index}`}
                        stroke={
                          colors[index % colors.length]
                        }
                        strokeWidth={2}
                        data={series.data}
                        x={(d) => newXScale(getDate(d)) ?? 0}
                        y={(d) =>
                          newYScale(getYValue(d)) ?? 0
                        }
                      />
                    ))}
                    {/* Tooltip components */}
                    {tooltipData && (
                      <g>
                        <Line
                          from={{
                            x: tooltipLeft - margin.left,
                            y: 0,
                          }}
                          to={{
                            x: tooltipLeft - margin.left,
                            y: innerHeight,
                          }}
                          stroke={
                            theme === 'dark'
                              ? '#d1d5db'
                              : '#000000'
                          }
                          strokeWidth={1.5}
                          pointerEvents="none"
                          strokeDasharray="6,3"
                        />
                        {tooltipData.map((d, i) => (
                          <GlyphCircle
                            key={`glyph-${i}`}
                            left={
                              newXScale(getDate(d.dataPoint)) ??
                              0
                            }
                            top={
                              newYScale(
                                getYValue(d.dataPoint)
                              ) ?? 0
                            }
                            size={110}
                            fill={
                              colors[
                                d.seriesIndex % colors.length
                              ]
                            }
                            stroke={
                              theme === 'dark'
                                ? 'white'
                                : 'black'
                            }
                            strokeWidth={2}
                          />
                        ))}
                      </g>
                    )}
                  </Group>
                  {/* Zoom overlay */}
                  <rect
                    width={innerWidth}
                    height={innerHeight}
                    fill="transparent"
                    onMouseDown={zoom.dragStart}
                    onMouseMove={(event) => {
                      zoom.dragMove(event);
                      handleTooltip(event, zoom);
                    }}
                    onMouseUp={zoom.dragEnd}
                    onMouseLeave={(event) => {
                      if (zoom.isDragging) zoom.dragEnd();
                      hideTooltip();
                    }}
                    onTouchStart={zoom.dragStart}
                    onTouchMove={zoom.dragMove}
                    onTouchEnd={zoom.dragEnd}
                    onDoubleClick={(event) => {
                      const point =
                        localPoint(event) || { x: 0, y: 0 };
                      zoom.scale({
                        scaleX: 1.5,
                        scaleY: 1.5,
                        point,
                      });
                    }}
                    onWheel={(event) => {
                      event.preventDefault();
                      const point =
                        localPoint(event) || { x: 0, y: 0 };
                      const delta = -event.deltaY / 500; // Adjust sensitivity
                      const scale = 1 + delta;
                      zoom.scale({
                        scaleX: scale,
                        scaleY: scale,
                        point,
                      });
                    }}
                    style={{
                      cursor: zoom.isDragging
                        ? 'grabbing'
                        : 'grab',
                    }}
                  />
                </Group>
              </svg>
              {/* Tooltip */}
              {tooltipData && (
                <TooltipWithBounds
                  top={tooltipTop}
                  left={tooltipLeft}
                  style={tooltipStyles}
                >
                  <div>
                    <strong>Date: </strong>
                    {formatDate(
                      getDate(tooltipData[0].dataPoint)
                    )}
                  </div>
                  {tooltipData.map((d, i) => (
                    <div key={`tooltip-${i}`}>
                      <strong
                        style={{
                          color:
                            colors[
                              d.seriesIndex % colors.length
                            ],
                        }}
                      >
                        {d.seriesLabel}:{' '}
                      </strong>
                      {getYValue(d.dataPoint)}
                    </div>
                  ))}
                </TooltipWithBounds>
              )}
            </>
          );
        }}
      </Zoom>
    </div>
  );
}

export default LineChart;
