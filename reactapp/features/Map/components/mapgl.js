import React, { useEffect, useState, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import appAPI from 'services/api/app';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { useModelRunsContext } from 'features/ModelRuns/hooks/useModelRunsContext';
import useTheme from 'hooks/useTheme';
import { toast } from 'react-toastify';

const onMapLoad = (event) => {
  // console.log('Map loaded:', event);
  const map = event.target;

  // Set pointer interactions
  const hoverLayers = ['catchments-layer', 'unclustered-point', 'clusters'];
  hoverLayers.forEach((layer) => {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  });

  // Bring specific layers to front
  ['unclustered-point', 'clusters', 'cluster-count'].forEach((layerId) => {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  });

  // Optional filtering fix (if needed)
  if (map.getLayer('catchments-layer')) {
    map.setFilter('catchments-layer', ['any', ['in', 'divide_id', '']]);
  }
  if (map.getLayer('flowpaths-layer')) {
    map.setFilter('flowpaths-layer', ['any', ['in', 'id', '']]);
  }

  // Ensure highlight layers are on top
  ['nexus-highlight', 'catchment-highlight'].forEach((layerId) => {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  });
};

const MapComponent = () => {
  const { state: hydroFabricState, actions: hydroFabricActions } = useHydroFabricContext();
  const { state: modelRunsState } = useModelRunsContext();
  const theme = useTheme();
  const mapRef = useRef(null);

  // Highlight states
  const [selectedNexusId, setSelectedNexusId] = useState(null);
  const [selectedCatchmentId, setSelectedCatchmentId] = useState(null);

  // Data/config states
  const [nexusPoints, setNexusPoints] = useState(null);
  const [catchmentsFilterIds, setCatchmentsFilterIds] = useState(null);
  const [flowPathsFilterIds, setFlowPathsFilterIds] = useState(null);
  const [nexusFilterIds, setNexusFilterIds] = useState(null);

  // Derived booleans from store
  const isClustered = hydroFabricState.nexus.geometry.clustered;
  const isNexusHidden = hydroFabricState.nexus.geometry.hidden;
  const isCatchmentHidden = hydroFabricState.catchment.geometry.hidden; // default false

  const mapStyleUrl =
    theme === 'dark'
      ? 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json'
      : 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json';

  // Memoized layer config for catchments
  const catchmentConfig = useMemo(() => {
    if (!catchmentsFilterIds) return null;
    return {
      id: 'catchments-layer',
      type: 'fill',
      source: 'hydrofabric',
      'source-layer': 'conus_divides',
      filter: ['any', ['in', 'divide_id', ...catchmentsFilterIds]],
      paint: {
        'fill-color': theme === 'dark'
          ? 'rgba(238, 51, 119, 0.316)'
          : 'rgba(91, 44, 111, 0.316)',
        'fill-outline-color': theme === 'dark'
          ? 'rgba(238, 51, 119, 0.7)'
          : 'rgba(91, 44, 111, 0.7)',
        'fill-opacity': { stops: [[7, 0], [11, 1]] },
      },
      // Force catchments visible if not toggled hidden
      layout: {
        visibility: isCatchmentHidden ? 'none' : 'visible',
      },
    };
  }, [catchmentsFilterIds, theme, isCatchmentHidden]);

  // Memoized layer config for flowpaths
  const flowPathsConfig = useMemo(() => {
    if (!flowPathsFilterIds) return null;
    return {
      id: 'flowpaths-layer',
      type: 'line',
      source: 'hydrofabric',
      'source-layer': 'conus_flowpaths',
      filter: ['any', ['in', 'id', ...flowPathsFilterIds]],
      paint: {
        'line-color': theme === 'dark' ? '#0077bb' : '#000000',
        'line-width': { stops: [[7, 1], [10, 2]] },
        'line-opacity': { stops: [[7, 0], [11, 1]] },
      }
    };
  }, [flowPathsFilterIds, theme]);

  // Memoized layer config for gauges
  const conusGaugesConfig = useMemo(() => {
    if (!nexusFilterIds) return null;
    return {
      id: 'gauges-layer',
      type: 'circle',
      source: 'hydrofabric',
      'source-layer': 'conus_gages',
      filter: ['any', ['in', 'nex_id', ...nexusFilterIds]],
      paint: {
        'circle-radius': { stops: [[3, 2], [11, 5]] },
        'circle-color': theme === 'dark' ? '#c8c8c8' : '#646464',
        'circle-opacity': { stops: [[3, 0], [9, 1]] },
      }
    };
  }, [nexusFilterIds, theme]);

  // Memoized nexus layers
  const nexusLayers = useMemo(() => {
    // console.log('Nexus layers updated', nexusPoints, isNexusHidden);
    if (!nexusPoints || isNexusHidden) return null;

    const baseLayers = [];
    const highlightLayer = (
      <Layer
        key="nexus-highlight"
        id="nexus-highlight"
        type="circle"
        source="nexus-points"
        filter={selectedNexusId ? [
          'all',
          ['!', ['has', 'point_count']],
          ['==', ['get', 'id'], selectedNexusId]
        ] : ['==', ['get', 'id'], '']}
        paint={{
          'circle-radius': 10,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
          'circle-color': '#ff0000',
        }}
      />
    );

    if (isClustered) {
      baseLayers.push(
        <Layer
          key="clusters"
          id="clusters"
          type="circle"
          source="nexus-points"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': [
              'step',
              ['get', 'point_count'],
              // theme === 'dark' ? '#51bbd6' : '#1f78b4',
              // 10,
              // theme === 'dark' ? '#6610f2' : '#33a02c',
              // 50,
              // theme === 'dark' ? '#20c997' : '#e31a1c',
              '#51bbd6' ,
              10,
              '#6610f2',
              50,
              '#20c997',
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
          }}
        />,
        <Layer
          key="cluster-count"
          id="cluster-count"
          type="symbol"
          source="nexus-points"
          filter={['has', 'point_count']}
          layout={{
            'text-field': '{point_count_abbreviated}',
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-anchor': 'center',
            'text-justify': 'center',
            'symbol-placement': 'point',
          }}
          paint={{
            // 'text-color': theme === 'dark' ? '#ffffff' : '#000000',
            'text-color': '#ffffff',
          }}
        />,
        <Layer
          key="unclustered-point"
          id="unclustered-point"
          type="circle"
          source="nexus-points"
          filter={['!', ['has', 'point_count']]}
          paint={{
            'circle-color': theme === 'dark' ? '#4f5b67' : '#1f78b4',
            'circle-radius': 7,
            'circle-stroke-width': 2,
            'circle-stroke-color': theme === 'dark' ? '#e9ecef' : '#ffffff',
          }}
        />
      );
    } else {
      baseLayers.push(
        <Layer
          key="all-points"
          id="all-points"
          type="circle"
          source="nexus-points"
          paint={{
            'circle-color': theme === 'dark' ? '#4f5b67' : '#1f78b4',
            'circle-radius': 7,
            'circle-stroke-width': 1,
            'circle-stroke-color': theme === 'dark' ? '#e9ecef' : '#ffffff',
          }}
        />
      );
    }

    return [...baseLayers, highlightLayer];
  }, [nexusPoints, isClustered, isNexusHidden, theme, selectedNexusId]);

  // --------------------------------------------
  // Data fetching: get geospatial data and filters
  // --------------------------------------------
  useEffect(() => {
    // console.log('MapComponent mounted');
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    if (!modelRunsState.base_model_id) return;

    appAPI.getGeoSpatialData({ model_run_id: modelRunsState.base_model_id })
      .then((response) => {
        if (response.error) {
          toast.error("Error fetching Model Run Data", { autoClose: 1000 });
          hydroFabricActions.reset();
          setNexusPoints(null);
          setCatchmentsFilterIds(null);
          setFlowPathsFilterIds(null);
          setNexusFilterIds(null);
          setSelectedCatchmentId(null);
          setSelectedNexusId(null);
          return;
        }

        toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
        setNexusPoints(response.nexus);
        setCatchmentsFilterIds(response.catchments);
        setFlowPathsFilterIds(response.flow_paths_ids);
        setNexusFilterIds(response.nexus_ids);

        if (response.bounds && mapRef.current) {
          mapRef.current.fitBounds(response.bounds, {
            padding: 20,
            duration: 1000,
          });
        }
      })
      .catch((error) => {
        console.error('Geospatial data fetch failed:', error);
      });

    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, [theme, modelRunsState.base_model_id]);


  // ------------------------------------
  // ON CLICK: update state based on clicked layer
  // ------------------------------------
  const handleMapClick = async (event) => {
    // console.log('Map clicked:', event);
    const map = event.target;
    const isClusteredNow = !!hydroFabricState.nexus.geometry?.clustered;

    // Build layersToQuery based on current hidden states
    const layersToQuery = [];
    if (!isNexusHidden) {
      layersToQuery.push(isClusteredNow ? 'unclustered-point' : 'all-points');
      if (isClusteredNow) layersToQuery.push('clusters');
    }
    if (!isCatchmentHidden) {
      layersToQuery.push('catchments-layer');
    }
    if (layersToQuery.length === 0) return;

    const features = map.queryRenderedFeatures(event.point, { layers: layersToQuery });
    if (!features || !features.length) return;

    for (const feature of features) {
      const layerId = feature.layer.id;

      if (layerId === 'all-points' || layerId === 'unclustered-point') {
        // Clicked a nexus point.
        hydroFabricActions.reset_teehr();
        hydroFabricActions.reset_troute();

        const nexusId = feature.properties.id;
        hydroFabricActions.set_nexus_id(nexusId);
        hydroFabricActions.set_troute_id(nexusId);
        setSelectedNexusId(nexusId);
        setSelectedCatchmentId(null);

        // When clicking a nexus point, ensure catchments remain hidden.
        if (!isNexusHidden) {
          hydroFabricActions.show_nexus_geometry();
        }

        if (feature.properties.ngen_usgs !== 'none') {
          hydroFabricActions.set_teehr_id(feature.properties.ngen_usgs);
        }
        return;
      }
      
      if (layerId === 'clusters') {
        // Expand cluster.
        const clusterId = feature.properties.cluster_id;
        const zoom = await map.getSource('nexus-points').getClusterExpansionZoom(clusterId);
        map.flyTo({
          center: feature.geometry.coordinates,
          zoom,
          speed: 1.2,
        });
        return;
      }
      
      if (layerId === 'catchments-layer') {
        // Clicked a catchment.
        hydroFabricActions.reset_teehr();
        hydroFabricActions.reset_troute();

        const divideId = feature.properties.divide_id;
        hydroFabricActions.set_catchment_id(divideId);
        hydroFabricActions.set_troute_id(divideId);
        setSelectedCatchmentId(divideId);
        setSelectedNexusId(null);

        // When clicking a catchment, ensure nexus remains hidden.
        if (!isCatchmentHidden) {
          hydroFabricActions.show_catchment_geometry();
        }
        
        return;
      }
    }
  };

  // Re-mount the source if clustering state changes.
  const sourceKey = isClustered ? 'clustered-nexus' : 'unclustered-nexus';

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: -96, latitude: 40, zoom: 4 }}
      style={{ width: '100%', height: '100%' }}
      mapLib={maplibregl}
      mapStyle={mapStyleUrl}
      onClick={handleMapClick}
      onLoad={onMapLoad}
    >
      <Source
        id="conus"
        type="vector"
        url="pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles"
      >
        {catchmentConfig && <Layer {...catchmentConfig} />}
        {flowPathsConfig && <Layer {...flowPathsConfig} />}
        {conusGaugesConfig && <Layer {...conusGaugesConfig} />}
        <Layer
          id="catchment-highlight"
          type="fill"
          source="hydrofabric"
          source-layer="conus_divides"
          filter={selectedCatchmentId 
            ? ['==', ['get', 'divide_id'], selectedCatchmentId]
            : ['==', ['get', 'divide_id'], '']}
          paint={{
            'fill-color': '#ff0000',
            'fill-outline-color': '#ffffff',
            'fill-opacity': 0.5,
          }}
          layout={{ visibility: isCatchmentHidden ? 'none' : 'visible' }}
        />
      </Source>

      <Source
          key={`nexus-source-${isClustered}`}
          id="nexus-points"
          type="geojson"
          data={nexusPoints}
          cluster={isClustered}
          clusterRadius={50}
          clusterMaxZoom={14}
        >
          {nexusLayers}
        </Source>

      {/* {nexusPoints && (
        <Source
          key={`nexus-source-${isClustered}`}
          id="nexus-points"
          type="geojson"
          data={nexusPoints}
          cluster={isClustered}
          clusterRadius={50}
          clusterMaxZoom={14}
        >
          {nexusLayers}
        </Source>
      )} */}
    </Map>
  );
};

export default MapComponent;
