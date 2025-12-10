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
import { localPoint } from '@visx/event';
import { GlyphCircle } from '@visx/glyph';
import { timeFormat } from 'd3-time-format';
import { RectClipPath } from '@visx/clip-path';
import { getVariableUnits } from '../../lib/getTimeSeries';
import useDataStreamStore from '../../store/Datastream';

function LineChart({ width, height, data, layout }) {
  const forecast = useDataStreamStore((state) => state.forecast);
  const screenWidth = window.innerWidth;
  const fontSize = screenWidth <= 1300 ? 13 : 18;
  const fontWeight = screenWidth <= 1300 ? 600 : 500;

  const [zoomKey, setZoomKey] = useState(0);

  // --- NEW: read CSS variables for chart colors ---
  const rootStyles = getComputedStyle(document.documentElement);

  const axisLabelColor =
    rootStyles.getPropertyValue('--chart-axis-label-color').trim() ||
    '#111827';
  const axisStrokeColor =
    rootStyles.getPropertyValue('--chart-axis-stroke-color').trim() ||
    '#111827';
  const axisTickColor =
    rootStyles.getPropertyValue('--chart-axis-tick-color').trim() ||
    '#111827';
  const axisTickTextColor =
    rootStyles.getPropertyValue('--chart-axis-tick-text-color').trim() ||
    '#111827';
  const gridColor =
    rootStyles.getPropertyValue('--chart-grid-color').trim() || '#e5e7eb';
  const tooltipBg =
    rootStyles.getPropertyValue('--chart-tooltip-bg').trim() ||
    'rgba(255, 255, 255, 0.95)';
  const tooltipTextColor =
    rootStyles.getPropertyValue('--chart-tooltip-text').trim() ||
    '#111827';
  const tooltipBorderColor =
    rootStyles.getPropertyValue('--chart-tooltip-border-color').trim() ||
    'rgba(148, 163, 184, 0.6)';
  const crosshairColor =
    rootStyles.getPropertyValue('--chart-crosshair-color').trim() ||
    '#4b5563';
  const glyphStrokeColor =
    rootStyles.getPropertyValue('--chart-glyph-stroke-color').trim() ||
    '#ffffff';
  const noDataTextColor =
    rootStyles.getPropertyValue('--chart-empty-text-color').trim() ||
    '#6b7280';

  // line colors: comma-separated in CSS var
  const lineColorsVar = rootStyles
    .getPropertyValue('--chart-line-colors')
    .trim();
  const colors = lineColorsVar
    ? lineColorsVar.split(/\s*,\s*/)
    : ['#1d4ed8', '#f97316', '#16a34a', '#dc2626', '#7c3aed'];

  const getAxisLabelStyles = () => ({
    fill: axisLabelColor,
    fontSize,
    fontWeight,
  });

  useEffect(() => {
    setZoomKey((k) => k + 1);
  }, [data, layout?.yaxis]);

  const yAxisLabel = useMemo(() => {
    const yaxisValue = layout?.yaxis || '';
    if (!yaxisValue) return '';
    const units = getVariableUnits(yaxisValue);
    return units ? `${yaxisValue} (${units})` : yaxisValue;
  }, [layout?.yaxis]);

  const {
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
    showTooltip,
    hideTooltip,
  } = useTooltip();

  const margin = { top: 40, right: 10, bottom: 30, left: 40 };
  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  const EST_LABEL_PX = 100;
  const xNumTicks = Math.max(2, Math.floor(innerWidth / EST_LABEL_PX));

  const getDate = (d) => (d.x instanceof Date ? d.x : new Date(d.x));
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

  const tooltipStyles = {
    ...defaultStyles,
    minWidth: 60,
    backgroundColor: tooltipBg,
    color: tooltipTextColor,
    fontSize: 14,
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.25)',
    borderRadius: 6,
    border: `1px solid ${tooltipBorderColor}`,
    padding: '8px 10px',
  };

  const formatDate = useCallback(
    (date) => {
      const format = forecast === 'short_range' ? '%H:%M' : '%m/%d';
      const formatter = timeFormat(format);
      return formatter(date);
    },
    [forecast]
  );

  const formatTooltipDate = timeFormat('%Y-%m-%d %H:%M:%S');
  const bisectDate = bisector((d) => getDate(d)).left;
  const formatYValue = (val) =>
    val == null || Number.isNaN(val) ? '—' : val.toFixed(2);

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

  const getSafeXTicks = useCallback(
    (newXScale) => {
      const xTickValues = newXScale.ticks(xNumTicks);
      return xTickValues;
    },
    [xNumTicks]
  );

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
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
            const safeXTicks = getSafeXTicks(newXScale);

            return (
              <>
                <svg
                  width={width}
                  height={height}
                  style={{
                    cursor: zoom.isDragging ? 'grabbing' : 'grab',
                  }}
                >
                  {yAxisLabel && (
                    <text
                      x={10}
                      y={10}
                      fontSize={12}
                      fontWeight={600}
                      fill={axisLabelColor}
                    >
                      {yAxisLabel}
                    </text>
                  )}

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
                      stroke={gridColor}
                      strokeOpacity={0.25}
                      strokeWidth={1}
                    />
                    <GridColumns
                      scale={newXScale}
                      width={innerWidth}
                      height={innerHeight}
                      stroke={gridColor}
                      strokeOpacity={0.25}
                      strokeWidth={1}
                    />

                    <AxisLeft
                      scale={newYScale}
                      labelProps={{ style: getAxisLabelStyles() }}
                      stroke={axisStrokeColor}
                      tickStroke={axisTickColor}
                      tickLabelProps={() => ({
                        fill: axisTickTextColor,
                        fontSize: 12,
                        fontWeight: 500,
                        textAnchor: 'end',
                      })}
                    />
                    <AxisBottom
                      scale={newXScale}
                      top={innerHeight}
                      labelProps={{ style: getAxisLabelStyles() }}
                      stroke={axisStrokeColor}
                      tickFormat={formatDate}
                      tickStroke={axisTickColor}
                      tickLabelProps={() => ({
                        fill: axisTickTextColor,
                        fontSize: 12,
                        fontWeight: 500,
                        textAnchor: 'middle',
                      })}
                      tickValues={safeXTicks}
                    />

                    <Group clipPath="url(#chart-clip)">
                      {data.map((series, index) => (
                        <LinePath
                          key={`line-${index}`}
                          stroke={colors[index % colors.length]}
                          strokeWidth={2.2}
                          data={series.data}
                          x={(d) => newXScale(getDate(d)) ?? 0}
                          y={(d) => newYScale(getYValue(d)) ?? 0}
                        />
                      ))}

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
                            stroke={crosshairColor}
                            strokeWidth={1.5}
                            pointerEvents="none"
                            strokeDasharray="6,3"
                          />
                          {tooltipData.map((d, i) => (
                            <GlyphCircle
                              key={`glyph-${i}`}
                              left={
                                newXScale(getDate(d.dataPoint)) ?? 0
                              }
                              top={
                                newYScale(getYValue(d.dataPoint)) ?? 0
                              }
                              size={110}
                              fill={
                                colors[d.seriesIndex % colors.length]
                              }
                              stroke={glyphStrokeColor}
                              strokeWidth={2}
                            />
                          ))}
                        </g>
                      )}
                    </Group>

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
                        zoom.scale({
                          scaleX: 1.5,
                          scaleY: 1.5,
                          point,
                        });
                      }}
                      onWheel={(e) => {
                        const point = localPoint(e) || { x: 0, y: 0 };
                        const delta = -e.deltaY / 500;
                        const scale = 1 + delta;
                        zoom.scale({
                          scaleX: scale,
                          scaleY: scale,
                          point,
                        });
                      }}
                      style={{
                        cursor: zoom.isDragging ? 'grabbing' : 'grab',
                      }}
                    />
                  </Group>
                </svg>

                {tooltipData && (
                  <TooltipWithBounds
                    top={tooltipTop}
                    left={tooltipLeft}
                    style={tooltipStyles}
                  >
                    <div style={{ marginBottom: 4 }}>
                      <strong>Date: </strong>
                      {formatTooltipDate(
                        getDate(tooltipData[0].dataPoint)
                      )}
                    </div>
                    {tooltipData.map((d, i) => (
                      <div key={`tooltip-${i}`}>
                        <strong
                          style={{
                            color:
                              colors[d.seriesIndex % colors.length],
                          }}
                        >
                          {d.seriesLabel}:{' '}
                        </strong>
                        {formatYValue(getYValue(d.dataPoint))}
                      </div>
                    ))}
                  </TooltipWithBounds>
                )}
              </>
            );
          }}
        </Zoom>
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontStyle: 'italic',
            fontSize: '1rem',
            color: noDataTextColor,
          }}
        >
          🛠️ No data to display
        </div>
      )}
    </div>
  );
}

export default LineChart;
