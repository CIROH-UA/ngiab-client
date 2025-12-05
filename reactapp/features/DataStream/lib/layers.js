export const reorderLayers = (map) => {
  if (!map) return;
  // Draw order from bottom → top
  const LAYER_ORDER = [
    'flowpaths',
    'conus-gauges',
    'divides',
    'divides-highlight',
    'nexus-points',
    'nexus-highlight',
  ];

  LAYER_ORDER.forEach((id) => {
    if (map.getLayer(id)) {
      // moveLayer with no beforeId = move to top
      map.moveLayer(id);
    }
  });
};
