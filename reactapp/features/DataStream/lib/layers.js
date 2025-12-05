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

export const symbologyColors = (theme) => ({
      nexusFill: theme === 'dark' ? '#4f5b67' : '#1f78b4',
      nexusStroke: theme === 'dark' ? '#e9ecef' : '#ffffff',
      catchmentFill:
        theme === 'dark'
          ? 'rgba(238, 51, 119, 0.32)'
          : 'rgba(91, 44, 111, 0.32)',
      catchmentStroke:
        theme === 'dark'
          ? 'rgba(238, 51, 119, 0.9)'
          : 'rgba(91, 44, 111, 0.9)',
      flowStroke: theme === 'dark' ? '#0077bb' : '#000000',
      gaugeFill: theme === 'dark' ? '#c8c8c8' : '#646464',
      gaugeStroke: theme === 'dark' ? '#111827' : '#ffffff',
})

export const getSymbology = (typeSymbol, colors) => {
  switch (typeSymbol) {
    case 'nexus':
      return (
        <NexusSymbol fill={colors.nexusFill} stroke={colors.nexusStroke} />
      );
    case 'catchments':
      return (
        <CatchmentSymbol
          fill={colors.catchmentFill}
          stroke={colors.catchmentStroke}
        />
      );
    case 'flowpaths':
      return <FlowPathSymbol stroke={colors.flowStroke} />;
    case 'conus_gauges':
      return (
        <GaugeSymbol fill={colors.gaugeFill} stroke={colors.gaugeStroke} />
      );
    default:
      return null;
  }
}

// --- Small SVG legend symbols ----------------------------------

export const NexusSymbol = ({ fill, stroke }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    style={{ marginRight: '8px' }}
  >
    <circle cx="9" cy="9" r="5" fill={fill} stroke={stroke} strokeWidth="2" />
  </svg>
);

export const CatchmentSymbol = ({ fill, stroke }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    style={{ marginRight: '8px' }}
  >
    <rect
      x="3"
      y="4"
      width="12"
      height="10"
      rx="2"
      ry="2"
      fill={fill}
      stroke={stroke}
      strokeWidth="1.5"
    />
  </svg>
);

export const FlowPathSymbol = ({ stroke }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    style={{ marginRight: '8px' }}
  >
    <path
      d="M2 13 C 5 9, 9 11, 16 5"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const GaugeSymbol = ({ fill, stroke }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    style={{ marginRight: '8px' }}
  >
    <circle cx="9" cy="9" r="4" fill={fill} stroke={stroke} strokeWidth="1.5" />
  </svg>
);