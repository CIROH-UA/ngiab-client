// MapComponent.jsx
import React, { useEffect, useState, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import appAPI from 'services/api/app';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import useTheme from 'hooks/useTheme';
// Define the onMapLoad function
const onMapLoad = (event) => {
  const map = event.target;
  const hoverLayers = ['catchments-layer', 'unclustered-point', 'clusters'];

  hoverLayers.forEach((layer) => {
    // Change cursor to pointer on mouse enter
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    // Revert cursor to default on mouse leave
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
    });
  });
  // Ensure 'unclustered-point' and 'clusters' layers are rendered on top of others

  if (map.getLayer('unclustered-point')) {
    map.moveLayer('unclustered-point');
  }
  if (map.getLayer('clusters')) {
    map.moveLayer('clusters');
  }

  if (map.getLayer('catchments')) {
    map.setFilter('catchments', ['any', ['in', 'divide_id', '']]);
  }
  if (map.getLayer('flowpaths')) {
    map.setFilter('flowpaths', ['any', ['in', 'id', '']]);
  }
  if (map.getLayer('cluster-count')) {
    map.moveLayer('cluster-count');
  }
};

const MapComponent = () => {
  const { actions: hydroFabricActions } = useHydroFabricContext();
  const [nexusPoints, setNexusPoints] = useState(null);
  const [catchmentConfig, setCatchmentConfig] = useState(null);
  const [flowPathsConfig, setFlowPathsConfig] = useState(null);
  const [conusGaugesConfig, setConusGaugesConfig] = useState(null);
  const mapRef = useRef(null);
  const theme = useTheme();

  const mapStyleUrl =
    theme === 'dark'
      ? 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json'
      : 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json';

  // Adjust clusterLayer with theme-based colors
  const clusterLayer = {
    id: 'clusters',
    type: 'circle',
    source: 'nexus-points',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        theme === 'dark' ? '#51bbd6' : '#1f78b4',
        10,
        theme === 'dark' ? '#6610f2' : '#33a02c',
        50,
        theme === 'dark' ? '#20c997' : '#e31a1c',
      ],
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        15,
        10,
        25,
        50,
        35,
      ],
    },
  };

  // Adjust unclusteredPointLayer with theme-based colors
  const unclusteredPointLayer = {
    id: 'unclustered-point',
    type: 'circle',
    source: 'nexus-points',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': theme === 'dark' ? '#2c3e50' : '#1f78b4',
      'circle-radius': 7,
      'circle-stroke-width': 2,
      'circle-stroke-color': theme === 'dark' ? '#e9ecef' : '#ffffff',
    },
  };

  // Adjust clusterCountLayer text color
  const clusterCountLayer = {
    id: 'cluster-count',
    type: 'symbol',
    source: 'nexus-points',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-anchor': 'center',
      'text-justify': 'center',
      'symbol-placement': 'point',
    },
    paint: {
      'text-color': theme === 'dark' ? '#ffffff' : '#000000',
    },
  };


  useEffect(() => {
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    appAPI
      .getGeoSpatialData()
      .then((response) => {
        const { nexus, bounds } = response;
        setNexusPoints(nexus);
        // Fit the map to the bounds from the backend response
        if (bounds && mapRef.current) {
          mapRef.current.fitBounds(bounds, {
            padding: 20,
            duration: 1000,
          });
        }

        const catchmentLayerConfig = {
          id: 'catchments-layer',
          type: 'fill',
          source: 'hydrofabric',
          'source-layer': 'conus_divides',
          filter: ['any', ['in', 'divide_id', ...response.catchments]],
          paint: {
            'fill-color':
              theme === 'dark'
                ? ['rgba', 238, 51, 119, 0.316]
                : ['rgba', 91, 44, 111, 0.316],
            'fill-outline-color':
              theme === 'dark'
                ? ['rgba', 238, 51, 119, 0.7]
                : ['rgba', 91, 44, 111, 0.7],
            'fill-opacity': { stops: [[7, 0], [11, 1]] },
          },
        };
        setCatchmentConfig(catchmentLayerConfig);

        const flowPathsLayerConfig = {
          id: 'flowpaths-layer',
          type: 'line',
          source: 'hydrofabric',
          'source-layer': 'conus_flowpaths',
          paint: {
            'line-color':
              theme === 'dark'
                ? ['rgba', 0, 119, 187, 1]
                : ['rgba', 0, 0, 0, 1], // Adjusted color for light theme
            'line-width': { stops: [[7, 1], [10, 2]] },
            'line-opacity': { stops: [[7, 0], [11, 1]] },
          },
          filter: ['any', ['in', 'id', ...response.flow_paths_ids]],
        };

        setFlowPathsConfig(flowPathsLayerConfig);

        const conusGaugesLayerConfig = {
          id: 'gauges-layer',
          type: 'circle',
          source: 'hydrofabric',
          'source-layer': 'conus_gages',
          filter: ['any', ['in', 'nex_id', ...response.nexus_ids]],
          paint: {
            'circle-radius': { stops: [[3, 2], [11, 5]] },
            'circle-color':
              theme === 'dark'
                ? ['rgba', 200, 200, 200, 1]
                : ['rgba', 100, 100, 100, 1],
            'circle-opacity': { stops: [[3, 0], [9, 1]] },
          },
        };

        setConusGaugesConfig(conusGaugesLayerConfig);
      })
      .catch((error) => {
        console.log(error);
      });

    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, [theme]); // Add theme to dependency array

  // Define the PMTiles source URL
  const pmtilesUrl =
    'pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles';

  const handleMapClick = async (event) => {
    const map = event.target;

    // Prioritize clicking on 'unclustered-point' and 'clusters' layers first
    const features = map.queryRenderedFeatures(event.point, {
      layers: ['unclustered-point', 'clusters', 'catchments-layer'],
    });

    if (features.length > 0) {
      // Loop through all features at the click point
      for (const feature of features) {
        const layerId = feature.layer.id;
        // Priority click handling for 'unclustered-point' and 'clusters'
        if (layerId === 'unclustered-point') {
          hydroFabricActions.reset_teehr();
          const nexus_id = feature.properties.id;
          hydroFabricActions.set_nexus_id(nexus_id);
          if (feature.properties.ngen_usgs !== 'none') {
            hydroFabricActions.set_teehr_id(feature.properties.ngen_usgs);
          }
          return; // Exit after handling unclustered point click
        } else if (layerId === 'clusters') {
          const clusterId = feature.properties.cluster_id;
          const zoom = await map
            .getSource('nexus-points')
            .getClusterExpansionZoom(clusterId);
          map.flyTo({
            center: feature.geometry.coordinates,
            zoom: zoom,
            speed: 1.2,
            curve: 1,
          });
          return; // Exit after handling cluster click
        }

        // Handle other layers, like 'catchments-layer', only if unclustered/clustered layers weren't clicked
        if (layerId === 'catchments-layer') {
          hydroFabricActions.reset_teehr();
          hydroFabricActions.set_catchment_id(feature.properties.divide_id);
          return;
        }
      }
    }
  };


  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: -96,
        latitude: 40,
        zoom: 4,
      }}
      style={{ width: '100%', height: '100%' }}
      mapLib={maplibregl}
      mapStyle={mapStyleUrl}
      onClick={handleMapClick}
      onLoad={onMapLoad}
    >
      {nexusPoints && (
        <Source
          id="nexus-points"
          type="geojson"
          data={nexusPoints}
          cluster={true}
          clusterRadius={50}
          clusterMaxZoom={14}
        >
          <Layer {...clusterLayer} />
          <Layer {...clusterCountLayer} />
          <Layer {...unclusteredPointLayer} />
        </Source>
      )}

      <Source id="conus" type="vector" url={pmtilesUrl}>
        {conusGaugesConfig && <Layer {...conusGaugesConfig} />}
        {catchmentConfig && <Layer {...catchmentConfig} />}
        {flowPathsConfig && <Layer {...flowPathsConfig} />}
      </Source>
    </Map>
  );
};

export default MapComponent;
