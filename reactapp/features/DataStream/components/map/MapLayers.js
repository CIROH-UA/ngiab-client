// mapLayers.js
import React, { useMemo } from 'react';
import { Layer } from 'react-map-gl/maplibre';

/**
 * Catchment (divides) layers
 */
export function useCatchmentLayers({
  isCatchmentsVisible,
  selectedFeatureId,
  dividesOutlineColor,
  dividesHighlightFillColor,
  dividesHighlightOutlineColor,
}) {
  return useMemo(() => {
    if (!isCatchmentsVisible) return null;

    const divides = (
      <Layer
        key="divides"
        id="divides"
        type="fill"
        source="hydrofabric"
        source-layer="conus_divides"
        paint={{
          'fill-color': ['rgba', 0, 0, 0, 0],
          'fill-outline-color': dividesOutlineColor,
          'fill-opacity': { stops: [[7, 0], [11, 1]] },
        }}
      />
    );

    const highlighted = (
      <Layer
        key="divides-highlight"
        id="divides-highlight"
        type="fill"
        source="hydrofabric"
        source-layer="conus_divides"
        beforeId="divides"
        filter={
          selectedFeatureId
            ? ['any', ['==', ['get', 'divide_id'], selectedFeatureId]]
            : ['==', ['get', 'divide_id'], '']
        }
        paint={{
          'fill-color': dividesHighlightFillColor,
          'fill-outline-color': dividesHighlightOutlineColor,
          'fill-opacity': { stops: [[7, 0], [11, 1]] },
        }}
      />
    );

    return [divides, highlighted];
  }, [
    isCatchmentsVisible,
    selectedFeatureId,
    dividesOutlineColor,
    dividesHighlightFillColor,
    dividesHighlightOutlineColor,
  ]);
}

/**
 * Flowpaths layer
 */
export function useFlowPathsLayer({ isFlowPathsVisible, flowpathsLineColor }) {
  return useMemo(() => {
    if (!isFlowPathsVisible) return null;

    return (
      <Layer
        key="flowpaths"
        id="flowpaths"
        type="line"
        source="hydrofabric"
        source-layer="conus_flowpaths"
        paint={{
          'line-color': flowpathsLineColor,
          'line-width': { stops: [[7, 1], [10, 2]] },
          'line-opacity': { stops: [[7, 0], [11, 1]] },
        }}
      />
    );
  }, [isFlowPathsVisible, flowpathsLineColor]);
}

/**
 * CONUS gauges layer
 */
export function useConusGaugesLayer({
  isConusGaugesVisible,
  gaugesCircleColor,
}) {
  return useMemo(() => {
    if (!isConusGaugesVisible) return null;

    return (
      <Layer
        key="conus-gauges"
        id="conus-gauges"
        type="circle"
        source="hydrofabric"
        source-layer="conus_gages"
        paint={{
          'circle-radius': { stops: [[3, 2], [11, 5]] },
          'circle-color': gaugesCircleColor,
          'circle-opacity': { stops: [[3, 0], [9, 1]] },
        }}
      />
    );
  }, [isConusGaugesVisible, gaugesCircleColor]);
}

/**
 * Nexus point + highlight layers
 */
export function useNexusLayers({
  isNexusVisible,
  selectedFeatureId,
  nexusCircleColor,
  nexusStrokeColor,
  nexusHighlightCircleColor,
}) {
  return useMemo(() => {
    if (!isNexusVisible) return null;

    const pointsLayer = (
      <Layer
        key="nexus-points"
        id="nexus-points"
        type="circle"
        source="nexus"
        source-layer="nexus"
        filter={['!', ['has', 'point_count']]} // do not show the clusters
        minzoom={5}
        paint={{
          'circle-radius': 7,
          'circle-color': nexusCircleColor,
          'circle-stroke-width': 1,
          'circle-stroke-color': nexusStrokeColor,
        }}
      />
    );

    const nexusHighlightLayer = (
      <Layer
        key="nexus-highlight"
        id="nexus-highlight"
        type="circle"
        source="nexus"
        source-layer="nexus"
        minzoom={5}
        beforeId="nexus-points"
        filter={
          selectedFeatureId
            ? [
                'all',
                ['!', ['has', 'point_count']],
                ['==', ['get', 'id'], selectedFeatureId],
              ]
            : ['boolean', false]
        }
        paint={{
          'circle-radius': 10,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
          'circle-color': nexusHighlightCircleColor,
        }}
      />
    );

    return [pointsLayer, nexusHighlightLayer];
  }, [
    isNexusVisible,
    selectedFeatureId,
    nexusCircleColor,
    nexusStrokeColor,
    nexusHighlightCircleColor,
  ]);
}
