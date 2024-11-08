import { useCallback } from "react";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { LinePath, Line } from "@visx/shape";
import { extent, bisector } from "d3-array";
import { GridRows, GridColumns } from "@visx/grid";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { GlyphCircle } from "@visx/glyph";
import { timeParse, timeFormat } from "d3-time-format";

function LineChart({ width, height, data }) {
  // Tooltip parameters
  const {
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
    showTooltip,
    hideTooltip,
  } = useTooltip();

  // Define margins
  const margin = { top: 40, right: 40, bottom: 40, left: 40 };

  // Inner dimensions
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Parse date string to Date object
  const parseDate = timeParse("%Y-%m-%d %H:%M:%S");

  // Flatten data to get all data points for scales
  const allData = data.flatMap((series) => series.data);

  // Data accessors
  const getDate = (d) => parseDate(d.x.trim());
  const getYValue = (d) => d.y;

  // Define scales
  const xScale = scaleTime({
    range: [0, innerWidth],
    domain: extent(allData, getDate),
    nice: true,
  });

  const yScale = scaleLinear({
    range: [innerHeight, 0],
    domain: extent(allData, getYValue),
    nice: true,
  });

  // Colors for each series
  const colors = ["#43b284", "#fab255", "#ff6361", "#58508d", "#ffa600"];

  // Tooltip styles
  const tooltipStyles = {
    ...defaultStyles,
    minWidth: 60,
    backgroundColor: "rgba(0,0,0,0.9)",
    color: "white",
    position: "absolute", // Ensure tooltip is absolutely positioned
  };

  // Date formatter
  const formatDate = timeFormat("%Y-%m-%d");

  // Bisector for finding closest data point
  const bisectDate = bisector((d) => getDate(d)).left;

  // Tooltip handler
  const handleTooltip = useCallback(
    (event) => {
      const { x } = localPoint(event) || { x: 0 };
      const x0 = xScale.invert(x - margin.left);

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

      // Calculate the tooltip's y-position (e.g., average or min y-position)
      const yPositions = tooltipDataArray.map((d) =>
        yScale(getYValue(d.dataPoint))
      );
      const tooltipTopPosition = Math.min(...yPositions) + margin.top;

      showTooltip({
        tooltipData: tooltipDataArray,
        tooltipLeft: x,
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
      margin.left,
      margin.top,
    ]
  );

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height}>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill={"#718096"}
          rx={14}
        />
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={innerWidth}
            height={innerHeight}
            stroke="#EDF2F7"
            strokeOpacity={0.2}
          />
          <GridColumns
            scale={xScale}
            width={innerWidth}
            height={innerHeight}
            stroke="#EDF2F7"
            strokeOpacity={0.2}
          />
          <AxisLeft
            scale={yScale}
            stroke={"#EDF2F7"}
            tickStroke={"#EDF2F7"}
            tickLabelProps={() => ({
              fill: "#EDF2F7",
              fontSize: 11,
              textAnchor: "end",
            })}
          />
          <text
            x="-125"
            y="20"
            transform="rotate(-90)"
            fontSize={12}
            fill="#EDF2F7"
          >
            Y-axis Label
          </text>
          <AxisBottom
            scale={xScale}
            stroke={"#EDF2F7"}
            tickFormat={formatDate}
            tickStroke={"#EDF2F7"}
            top={innerHeight}
            tickLabelProps={() => ({
              fill: "#EDF2F7",
              fontSize: 11,
              textAnchor: "middle",
            })}
          />
          {/* Render multiple lines */}
          {data.map((series, index) => (
            <LinePath
              key={`line-${index}`}
              stroke={colors[index % colors.length]}
              strokeWidth={3}
              data={series.data}
              x={(d) => xScale(getDate(d)) ?? 0}
              y={(d) => yScale(getYValue(d)) ?? 0}
            />
          ))}
          {/* Tooltip components */}
          {tooltipData && (
            <g>
              <Line
                from={{ x: tooltipLeft - margin.left, y: 0 }}
                to={{ x: tooltipLeft - margin.left, y: innerHeight }}
                stroke={"#EDF2F7"}
                strokeWidth={2}
                pointerEvents="none"
                strokeDasharray="4,2"
              />
              {tooltipData.map((d, i) => (
                <GlyphCircle
                  key={`glyph-${i}`}
                  left={tooltipLeft - margin.left}
                  top={yScale(getYValue(d.dataPoint))}
                  size={110}
                  fill={colors[d.seriesIndex % colors.length]}
                  stroke={"white"}
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
          {/* Overlay for capturing mouse events */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onTouchStart={handleTooltip}
            onTouchMove={handleTooltip}
            onMouseMove={handleTooltip}
            onMouseLeave={() => hideTooltip()}
          />
        </Group>
      </svg>
      {/* Render tooltip before the legend to prevent layout shifts */}
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
                style={{ color: colors[d.seriesIndex % colors.length] }}
              >
                {d.seriesLabel}:{" "}
              </strong>
              {getYValue(d.dataPoint)}
            </div>
          ))}
        </TooltipWithBounds>
      )}
      {/* Optional Legend */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: 10,
          position: "relative",
        }}
      >
        {data.map((series, index) => (
          <div
            key={`legend-${index}`}
            style={{
              display: "flex",
              alignItems: "center",
              marginRight: 10,
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
            <div style={{ color: "#EDF2F7", fontSize: 12 }}>
              {series.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LineChart;
