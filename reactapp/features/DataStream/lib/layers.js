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

export const CursorSymbol = ({
  fill = '#1f78b4',
  stroke = '#ffffff',
}) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    style={{ marginRight: '6px' }}
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Arrow body */}
    <path
      d="M4 3 L4 18 L8.5 14.5 L11 20 L13 19 L10.5 13.5 L15 13 Z"
      fill={fill}
      stroke={stroke}
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

export const BasinSymbol = ({
  fill = 'rgba(91, 44, 111, 0.32)',
  stroke = 'rgba(91, 44, 111, 0.9)',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    className="Eo3Yub"
  >
    <path
      d="M2.0975 7.12551L10.878 1.1499L18.5 13.8414L13.378 18.8502L1 16.5158L2.0975 7.12551Z"
      fill={fill}
      stroke={stroke}
      strokeWidth="1.5"
    />
  </svg>
);

export const DeleteDataIcon = (props) => (
  <svg
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    <rect x="6" y="4" width="12" height="2" rx="1" fill="currentColor" />
    <rect x="7" y="6" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <line x1="10" y1="8" x2="10" y2="16" stroke="currentColor" strokeWidth="1.2" />
    <line x1="14" y1="8" x2="14" y2="16" stroke="currentColor" strokeWidth="1.2" />

    <ellipse cx="18" cy="17" rx="3" ry="1.3" fill="currentColor" opacity="0.15" />
    <ellipse cx="18" cy="17" rx="3" ry="1.3" stroke="currentColor" strokeWidth="1" />
    <path
      d="M15 17v2.2c0 .7 1.3 1.3 3 1.3s3-.6 3-1.3V17"
      fill="currentColor"
      opacity="0.05"
    />
    <path
      d="M15 17v2.2c0 .7 1.3 1.3 3 1.3s3-.6 3-1.3V17"
      stroke="currentColor"
      strokeWidth="1"
    />
    <path
      d="M15 18.1c0 .7 1.3 1.3 3 1.3s3-.6 3-1.3"
      stroke="currentColor"
      strokeWidth="0.8"
      opacity="0.7"
    />
  </svg>
);