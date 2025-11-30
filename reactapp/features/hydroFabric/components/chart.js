// LineChart.js
import React, { useCallback, useMemo, useEffect, useState } from 'react';
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
import { LuExpand } from 'react-icons/lu';
import { localPoint } from '@visx/event';
import { GlyphCircle } from '@visx/glyph';
import { timeParse, timeFormat } from 'd3-time-format';
import { RectClipPath } from '@visx/clip-path';
import { lightTheme, darkTheme } from '@visx/xychart';
import useTheme from 'hooks/useTheme'; // ← adjust the path if needed

// Function to get units for common variables
const getVariableUnits = (variableName) => {
  if (!variableName) return '';
  // console.log(variableName);
  
  const variableUnits = {
    'rain_rate': 'mm/h',
    'giuh_runoff': 'mm',
    'infiltration_excess': '',
    'direct_runoff': '',
    'nash_lateral_runoff': '',
    'deep_gw_to_channel_flux': '',
    'soil_to_gw_flux': '',
    'q_out': '',
    'potential_et': '',
    'actual_et': '',
    'gw_storage': 'm/m',
    'soil_storage': 'm/m',
    'soil_storage_change': '',
    'surf_runoff_scheme': '',
    'nwm_ponded_depth': '',
    'type': '',
    'flow': 'm³/s',
    'velocity': 'm/s',
    'depth': 'm',
    'nudge': 'm³/s',
    'streamflow': 'm³/s',
};
  const variable = variableName.toLowerCase();
  return variableUnits[variable] ?? '';
};


function LineChart({ width, height, data, layout }) {
  // console.log("LineChart data:", data);
  const screenWidth = window.innerWidth;
  const fontSize = screenWidth <= 1300 ? 13 : 18;
  const fontWeight = screenWidth <= 1300 ? 600 : 500;

  const [zoomKey, setZoomKey] = useState(0);
  
  const getAxisLabelStyles = (theme) => ({
    fill: theme === 'dark' ? '#e0e0e0' : '#000',
    fontSize: fontSize,
    fontWeight: fontWeight,
  });

  useEffect(() => {
    // reset zoom whenever the series set or axis changes
    setZoomKey((k) => k + 1);
  }, [data, layout?.yaxis]);

  const yAxisLabel = useMemo(() => {
    const yaxisValue = layout?.yaxis || '';
    if (!yaxisValue) return '';
    const units = getVariableUnits(yaxisValue);
    return units ? `${yaxisValue} (${units})` : yaxisValue;
  }, [layout?.yaxis]);

  // Generate dynamic y-axis label
  const getYAxisLabel = () => {
    const yaxisValue = layout?.yaxis || '';
    const units = getVariableUnits(yaxisValue);
    if (!units) return yaxisValue;
    return yaxisValue + " (" + units + ")";
  };

  /* ─────────────────────────────────────
     Hooks – always execute, no early-return
     ───────────────────────────────────── */
  const theme = useTheme();
  const visxTheme = theme === 'dark' ? darkTheme : lightTheme;

  const {
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
    showTooltip,
    hideTooltip,
  } = useTooltip();

  /* ─────────────────────────────────────
     Layout helpers
     ───────────────────────────────────── */
  const margin = { top: 20, right: 40, bottom: 45, left: 110 };
  const innerWidth  = Math.max(1, width  - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top  - margin.bottom);
  const EST_LABEL_PX = 100;
  const xNumTicks = Math.max(2, Math.floor(innerWidth / EST_LABEL_PX));

  /* ─────────────────────────────────────
     Data preparation
     ───────────────────────────────────── */
  const parseDate = timeParse('%Y-%m-%d %H:%M:%S');
  // const getDate = (d) => parseDate(d.x);
  const getDate = (d) => d.x instanceof Date ? d.x : new Date(d.x);
  const getYValue = (d) => d.y;

  const safeExtent = (arr, accessor, fallback = [0, 1]) => {
    const [min, max] = extent(arr, accessor);
    return min == null || max == null ? fallback : [min, max];
  };

  const allData = useMemo(
    () => data.flatMap((s) => s.data ?? []),
    [data]
  );

  const hasData = allData.length > 0;

  const { xScale, yScale } = useMemo(() => {
    const x = scaleTime({
      range: [0, innerWidth],
      domain: safeExtent(allData, getDate, [new Date(), new Date()]),
    });

    const y = scaleLinear({
      range: [innerHeight, 0],
      domain: safeExtent(allData, getYValue, [0, 1]),
      nice: true,
    });

    return { xScale: x, yScale: y };
  }, [allData, innerWidth, innerHeight, getDate, getYValue]);


  const colors =
    theme === 'dark'
      ? ['#43b284', '#ff8c42', '#a566ff', '#20a4f3', '#ffc107']
      : ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd'];

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

  const formatDate = timeFormat('%Y-%m-%d');
  const bisectDate = bisector((d) => getDate(d)).left;

  /* ─────────────────────────────────────
     Scale helpers (for zoom)
     ───────────────────────────────────── */
  const rescaleXAxis = (scale, m) =>
    scale
      .copy()
      .domain(
        scale
          .range()
          .map((r) => scale.invert((r - m.translateX) / m.scaleX))
      );

  const rescaleYAxis = (scale, m) =>
    scale
      .copy()
      .domain(
        scale
          .range()
          .map((r) => scale.invert((r - m.translateY) / m.scaleY))
      );

  /* ─────────────────────────────────────
     Tooltip handler
     ───────────────────────────────────── */
  const handleTooltip = useCallback(
    (event, zoom) => {
      if (!hasData) return;

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
      hasData,
      showTooltip,
      xScale,
      yScale,
      data,
      bisectDate,
      margin.left,
      margin.top,
    ]
  );

  /* ─────────────────────────────────────
     Zoom constraint
     ───────────────────────────────────── */
  const constrain = (m) => {
    if (m.scaleX < 1) m.scaleX = 1;
    if (m.scaleY < 1) m.scaleY = 1;
    if (m.translateX > 0) m.translateX = 0;
    if (m.translateY > 0) m.translateY = 0;

    const max = applyMatrixToPoint(m, { x: innerWidth, y: innerHeight });
    if (max.x < innerWidth) m.translateX += innerWidth - max.x;
    if (max.y < innerHeight) m.translateY += innerHeight - max.y;

    return m;
  };

  /* ─────────────────────────────────────
     Render
     ───────────────────────────────────── */
  return (
    <div style={{ position: 'relative', width, height }}>
      {hasData ? (
        <Zoom
          key={zoomKey}
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
            const newXScale = rescaleXAxis(xScale, zoom.transformMatrix);
            const newYScale = rescaleYAxis(yScale, zoom.transformMatrix);
            const xTickValues = newXScale.ticks(xNumTicks);
            const safeXTicks = xTickValues.length > 1 ? xTickValues.slice(0, -1) : xTickValues;

            return (
              <>
                {/* Legend & controls */}
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
                            backgroundColor: colors[index % colors.length],
                            width: 10,
                            height: 10,
                            marginRight: 5,
                          }}
                        />
                        <div
                          style={{
                            color: theme === 'dark' ? '#f0f0f0' : '#000',
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
                      backgroundColor: theme === 'dark' ? '#4f5b67' : '#fff',
                      color: theme === 'dark' ? '#fff' : '#000',
                      border: '1px solid #ddd',
                      fontWeight: 'bold',
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
                  {/* Clip path to confine drawing/zoom */}
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
                      stroke={theme === 'dark' ? '#7f8c8d' : '#e0e0e0'}
                      strokeOpacity={0.1}
                      strokeWidth={1}
                    />
                    <GridColumns
                      scale={newXScale}
                      width={innerWidth}
                      height={innerHeight}
                      stroke={theme === 'dark' ? '#7f8c8d' : '#e0e0e0'}
                      strokeOpacity={0.1}
                      strokeWidth={1}
                    />

                    <AxisLeft
                      scale={newYScale}
                      label={yAxisLabel}
                      labelProps={{ style: getAxisLabelStyles(theme) }}
                      labelOffset={80}
                      stroke={theme === 'dark' ? '#d1d5db' : '#000'}
                      tickStroke={theme === 'dark' ? '#d1d5db' : '#000'}
                      tickLabelProps={() => ({
                        fill: theme === 'dark' ? '#e0e0e0' : '#000',
                        fontSize: 14,
                        fontWeight: 500,
                        textAnchor: 'end',
                        
                      })}
                    />
                    <AxisBottom
                      scale={newXScale}
                      top={innerHeight}
                      label="Simulation Time Period (YYYY-MM-DD)"
                      labelProps={{ style: getAxisLabelStyles(theme) }}
                      stroke={theme === 'dark' ? '#d1d5db' : '#000'}
                      tickFormat={formatDate}
                      tickStroke={theme === 'dark' ? '#d1d5db' : '#000'}
                      tickLabelProps={() => ({
                        fill: theme === 'dark' ? '#e0e0e0' : '#000',
                        fontSize: 14,
                        fontWeight: 500,
                        textAnchor: 'middle',
                      })}
                    />

                    <Group clipPath="url(#chart-clip)">
                      {/* Lines */}
                      {data.map((series, index) => (
                        <LinePath
                          key={`line-${index}`}
                          stroke={colors[index % colors.length]}
                          strokeWidth={2}
                          data={series.data}
                          x={(d) => newXScale(getDate(d)) ?? 0}
                          y={(d) => newYScale(getYValue(d)) ?? 0}
                        />
                      ))}

                      {/* Tooltip elements */}
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
                            stroke={theme === 'dark' ? '#d1d5db' : '#000'}
                            strokeWidth={1.5}
                            pointerEvents="none"
                            strokeDasharray="6,3"
                          />
                          {tooltipData.map((d, i) => (
                            <GlyphCircle
                              key={`glyph-${i}`}
                              left={newXScale(getDate(d.dataPoint)) ?? 0}
                              top={newYScale(getYValue(d.dataPoint)) ?? 0}
                              size={110}
                              fill={colors[d.seriesIndex % colors.length]}
                              stroke={theme === 'dark' ? 'white' : 'black'}
                              strokeWidth={2}
                            />
                          ))}
                        </g>
                      )}
                    </Group>

                    {/* Overlay for pan/zoom & tooltip capture */}
                    <rect
                      width={innerWidth}
                      height={innerHeight}
                      fill="transparent"
                      onMouseDown={zoom.dragStart}
                      onMouseMove={(e) => {
                        zoom.dragMove(e);
                        handleTooltip(e, zoom);
                      }}
                      onMouseUp={zoom.dragEnd}
                      onMouseLeave={(e) => {
                        if (zoom.isDragging) zoom.dragEnd();
                        hideTooltip();
                      }}
                      onTouchStart={zoom.dragStart}
                      onTouchMove={zoom.dragMove}
                      onTouchEnd={zoom.dragEnd}
                      onDoubleClick={(e) => {
                        const point = localPoint(e) || { x: 0, y: 0 };
                        zoom.scale({ scaleX: 1.5, scaleY: 1.5, point });
                      }}
                      onWheel={(e) => {
                        // e.preventDefault();
                        const point = localPoint(e) || { x: 0, y: 0 };
                        const delta = -e.deltaY / 500; // sensitivity
                        const scale = 1 + delta;
                        zoom.scale({ scaleX: scale, scaleY: scale, point });
                      }}
                      style={{
                        cursor: zoom.isDragging ? 'grabbing' : 'grab',
                      }}
                    />
                  </Group>
                </svg>

                {/* Tooltip box */}
                {tooltipData && (
                  <TooltipWithBounds
                    top={tooltipTop}
                    left={tooltipLeft}
                    style={tooltipStyles}
                  >
                    <div>
                      <strong>Date: </strong>
                      {formatDate(getDate(tooltipData[0].dataPoint))}
                    </div>
                    {tooltipData.map((d, i) => (
                      <div key={`tooltip-${i}`}>
                        <strong
                          style={{
                            color: colors[d.seriesIndex % colors.length],
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
      ) : (
        /* Fallback when there's no data */
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontStyle: 'italic',
            fontSize: '1rem',
          }}
        >
          🛠️ No data to display
        </div>
      )}
    </div>
  );
}

export default LineChart;
