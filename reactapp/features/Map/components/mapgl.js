import React, { useEffect, useState, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import appAPI from 'services/api/app';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import useTheme from 'hooks/useTheme';

const onMapLoad = (event) => {
  const map = event.target;

  // Let the cursor become a pointer when hovering certain layers
  const hoverLayers = ['catchments-layer', 'unclustered-point', 'clusters'];
  hoverLayers.forEach((layer) => {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
    });
  });

  // Bring cluster layers up front if present
  ['unclustered-point', 'clusters', 'cluster-count'].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.moveLayer(layerId);
    }
  });

  // (Optional) Fix up filtering on these layers if needed
  if (map.getLayer('catchments-layer')) {
    map.setFilter('catchments-layer', ['any', ['in', 'divide_id', '']]);
  }
  if (map.getLayer('flowpaths-layer')) {
    map.setFilter('flowpaths-layer', ['any', ['in', 'id', '']]);
  }
};

const MapComponent = () => {
  const { state: hydroFabricState, actions: hydroFabricActions } = useHydroFabricContext();
  const { state: modelRunsState } = useModelRunsContext();
  const [nexusPoints, setNexusPoints] = useState(null);
  const [catchmentConfig, setCatchmentConfig] = useState(null);
  const [flowPathsConfig, setFlowPathsConfig] = useState(null);
  const [conusGaugesConfig, setConusGaugesConfig] = useState(null);

  const mapRef = useRef(null);
  const theme = useTheme();

  // Dark/light style
  const mapStyleUrl =
    theme === 'dark'
      ? 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json'
      : 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json';

  // Are we clustering nexus points or not?
  const isClustered = !!hydroFabricState.nexus.geometry?.clustered;
  // Are we hiding nexus points entirely?
  const isNexusHidden = !!hydroFabricState.nexus.geometry?.hidden;

  // Are we hiding catchments?
  const isCatchmentHidden = !!hydroFabricState.catchment.geometry?.hidden;

  // --------------
  // LAYER CONFIGS
  // --------------

  // (1) For cluster mode, cluster circles
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
    // Use layout visibility to hide them if isNexusHidden is true
    layout: {
      visibility: isNexusHidden ? 'none' : 'visible',
    },
  };

  // (2) For cluster mode, label each cluster
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
      visibility: isNexusHidden ? 'none' : 'visible',
    },
    paint: {
      'text-color': theme === 'dark' ? '#ffffff' : '#000000',
    },
  };

  // (3) For cluster mode, leftover single points
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
    layout: {
      visibility: isNexusHidden ? 'none' : 'visible',
    },
  };

  // (4) For no-cluster mode, show everything in one layer
  const allPointsNoClusterLayer = {
    id: 'all-points',
    type: 'circle',
    source: 'nexus-points',
    paint: {
      'circle-color': theme === 'dark' ? '#2c3e50' : '#1f78b4',
      'circle-radius': 5,
      'circle-stroke-width': 1,
      'circle-stroke-color': theme === 'dark' ? '#e9ecef' : '#ffffff',
    },
    // Hide them entirely if isNexusHidden is true
    layout: {
      visibility: isNexusHidden ? 'none' : 'visible',
    },
  };

  // --------------
  // LOAD DATA
  // --------------
  useEffect(() => {
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    if (modelRunsState.base_model_id == null) return;

    appAPI
      .getGeoSpatialData({ model_run_id: modelRunsState.base_model_id })
      .then((response) => {
        const { nexus, bounds } = response;
        setNexusPoints(nexus);

        // Fit the map to returned bounding box if present
        if (bounds && mapRef.current) {
          mapRef.current.fitBounds(bounds, {
            padding: 20,
            duration: 1000,
          });
        }

        // (a) Catchments
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
          // If isCatchmentHidden is true, hide the layer
          layout: {
            visibility: isCatchmentHidden ? 'none' : 'visible',
          },
        };
        setCatchmentConfig(catchmentLayerConfig);

        // (b) Flowpaths
        const flowPathsLayerConfig = {
          id: 'flowpaths-layer',
          type: 'line',
          source: 'hydrofabric',
          'source-layer': 'conus_flowpaths',
          paint: {
            'line-color':
              theme === 'dark'
                ? ['rgba', 0, 119, 187, 1]
                : ['rgba', 0, 0, 0, 1],
            'line-width': { stops: [[7, 1], [10, 2]] },
            'line-opacity': { stops: [[7, 0], [11, 1]] },
          },
          filter: ['any', ['in', 'id', ...response.flow_paths_ids]],
        };
        setFlowPathsConfig(flowPathsLayerConfig);

        // (c) Gauges
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
          // (You didn't mention hiding these, but you could if you wanted)
        };
        setConusGaugesConfig(conusGaugesLayerConfig);
      })
      .catch((error) => {
        console.log(error);
      });

    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, [theme, modelRunsState.base_model_id, isCatchmentHidden]);

  // --------------
  // ON CLICK
  // --------------
  const handleMapClick = async (event) => {
    const map = event.target;
    const isClusteredNow = !!hydroFabricState.nexus.geometry?.clustered;

    // If cluster is on, query cluster layers
    // If cluster is off, query all-points
    // We'll always check 'catchments-layer', if not hidden
    // (Though if it's hidden, there's no layer to click.)
    const layersToQuery = isClusteredNow
      ? ['unclustered-point', 'clusters', 'catchments-layer']
      : ['all-points', 'catchments-layer'];

    const features = map.queryRenderedFeatures(event.point, { layers: layersToQuery });
    if (!features || !features.length) return;

    for (const feature of features) {
      const layerId = feature.layer.id;
      if (layerId === 'all-points' || layerId === 'unclustered-point') {
        // Single point
        hydroFabricActions.reset_teehr();
        hydroFabricActions.reset_troute();
        const nexus_id = feature.properties.id;
        hydroFabricActions.set_nexus_id(nexus_id);
        hydroFabricActions.set_troute_id(nexus_id);
        if (feature.properties.ngen_usgs !== 'none') {
          hydroFabricActions.set_teehr_id(feature.properties.ngen_usgs);
        }
        return;
      } else if (layerId === 'clusters') {
        // It's a cluster - expand
        const clusterId = feature.properties.cluster_id;
        const zoom = await map.getSource('nexus-points').getClusterExpansionZoom(clusterId);
        map.flyTo({
          center: feature.geometry.coordinates,
          zoom,
          speed: 1.2,
          curve: 1,
        });
        return;
      } else if (layerId === 'catchments-layer') {
        // It's a catchment
        hydroFabricActions.reset_teehr();
        hydroFabricActions.reset_troute();
        hydroFabricActions.set_catchment_id(feature.properties.divide_id);
        hydroFabricActions.set_troute_id(feature.properties.divide_id);
        return;
      }
    }
  };

  // We set a dynamic key so the source re-mounts if isClustered changes
  const sourceKey = isClustered ? 'clustered-nexus' : 'unclustered-nexus';

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
      {/* Vector layers: catchments, flowpaths, gauges */}
      <Source id="conus" type="vector" url="pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles">
        {catchmentConfig && <Layer {...catchmentConfig} />}
        {flowPathsConfig && <Layer {...flowPathsConfig} />}
        {conusGaugesConfig && <Layer {...conusGaugesConfig} />}
      </Source>

      {/* If we have nexusPoints, show them either cluster or unclustered */}
      {nexusPoints && (
        <Source
          key={sourceKey}
          id="nexus-points"
          type="geojson"
          data={nexusPoints}
          cluster={isClustered}
          clusterRadius={50}
          clusterMaxZoom={14}
        >
          {isClustered ? (
            <>
              {/* 3 layers: cluster circles, cluster labels, leftover unclustered */}
              <Layer {...clusterLayer} />
              <Layer {...clusterCountLayer} />
              <Layer {...unclusteredPointLayer} />
            </>
          ) : (
            <Layer {...allPointsNoClusterLayer} />
          )}
        </Source>
      )}
    </Map>
  );
};

export default MapComponent;
