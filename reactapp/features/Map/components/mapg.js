import React, { useEffect, useState, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import useTheme from 'hooks/useTheme';
import { getFlowTimeseriesForNexus } from "features/DataStream/lib/nexusTimeseries";
import { debugSingleFeatureId } from 'features/DataStream/lib/vpuDataLoader';


const onMapLoad = (event) => {
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

const MapComponent = ({
  cs_context,
  ts_store
 }) => {
  const { state: hf_state, actions: hs_actions } = useHydroFabricContext();
  const set_series = ts_store((state) => state.set_series);

  const { state: cs_state } = cs_context();
  
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
  const isClustered = hf_state.nexus.geometry.clustered;
  const isNexusHidden = hf_state.nexus.geometry.hidden;
  const isCatchmentHidden = hf_state.catchment.geometry.hidden; // default false

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
    if (isNexusHidden) return null;

    const baseLayers = [];
    const highlightLayer = (
      <Layer
        key="nexus-highlight"
        id="nexus-highlight"
        type="circle"
        source-layer="nexus"
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
          source-layer="nexus"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': [
              'step',
              ['get', 'point_count'],
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
          source-layer="nexus"
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
          source-layer="nexus"
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
          source-layer="nexus"
          paint={{
            'circle-color': theme === 'dark' ? '#4f5b67' : '#1f78b4',
            'circle-radius': 7,
            'circle-stroke-width': 1,
            'circle-stroke-color': theme === 'dark' ? '#e9ecef' : '#ffffff',
          }}
        />
      );
    }
    console.log('Nexus layers computed:', baseLayers, highlightLayer);
    return [...baseLayers, highlightLayer];
  }, [nexusPoints, isClustered, isNexusHidden, theme, selectedNexusId]);

  // --------------------------------------------
  // Data fetching: get geospatial data and filters
  // --------------------------------------------
  // useEffect(() => {
  //   const protocol = new Protocol({ metadata: true });
  //   maplibregl.addProtocol('pmtiles', protocol.tile);

  //   if (!cs_state.base_model_id) return;

  //   appAPI.getGeoSpatialData({ model_run_id: cs_state.base_model_id })
  //     .then((response) => {
  //       if (response.error) {
  //         toast.error("Error fetching Model Run Data", { autoClose: 1000 });
  //         hs_actions.reset();
  //         setNexusPoints(null);
  //         setCatchmentsFilterIds(null);
  //         setFlowPathsFilterIds(null);
  //         setNexusFilterIds(null);
  //         setSelectedCatchmentId(null);
  //         setSelectedNexusId(null);
  //         return;
  //       }

  //       toast.success("Successfully retrieved Model Run Data", { autoClose: 1000 });
  //       setNexusPoints(response.nexus);
  //       setCatchmentsFilterIds(response.catchments);
  //       setFlowPathsFilterIds(response.flow_paths_ids);
  //       setNexusFilterIds(response.nexus_ids);

  //       if (response.bounds && mapRef.current) {
  //         mapRef.current.fitBounds(response.bounds, {
  //           padding: 20,
  //           duration: 1000,
  //         });
  //       }
  //     })
  //     .catch((error) => {
  //       console.error('Geospatial data fetch failed:', error);
  //     });

  //   return () => {
  //     maplibregl.removeProtocol('pmtiles');
  //   };
  // }, [theme, cs_state.base_model_id]);

  useEffect(() => {
    // Reset highlights when geometry layers are hidden
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);
    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);

  useEffect(() => {
    // Clear highlights when geometry changes
    console.log('Geometry changed, resetting highlights.');
    console.log(cs_state.geometry);
  }, [cs_state.geometry]);
  
  // ------------------------------------
  // ON CLICK: update state based on clicked layer
  // ------------------------------------
  const handleMapClick = async (event) => {
    console.log('Map clicked at:', event);
    const map = event.target;
    const isClusteredNow = !!hf_state.nexus.geometry?.clustered;

    // Build layersToQuery based on current hidden states
    const layersToQuery = [];
    if (!isNexusHidden) {
      layersToQuery.push(isClusteredNow ? 'unclustered-point' : 'all-points');
      if (isClusteredNow) layersToQuery.push('clusters');
    }
    if (!isCatchmentHidden) {
      layersToQuery.push('divides');
    }
    if (layersToQuery.length === 0) return;

    const features = map.queryRenderedFeatures(event.point, { layers: layersToQuery });
    if (!features || !features.length) return;

    for (const feature of features) {
      const layerId = feature.layer.id;
      console.log('Clicked feature from layer:', layerId, feature);
      if (layerId === 'all-points' || layerId === 'unclustered-point') {

        const featureId = feature.properties.id;
        const nexusId = featureId.split('-')[1];
        try {
          const series = await getFlowTimeseriesForNexus(nexusId);
          const xy = series.map(d => ({
            x: new Date(d.time),
            y: d.flow,
          }));
          set_series(xy);
          // Now you have [{ time, flow }, ...] — feed to visx, table, etc.
          // Example:
          // setSelectedNexusId(nexusId);
          // setNexusFlowSeries(series);

          console.log("Flow timeseries for", nexusId, series.slice(0, 5));
        } catch (err) {
          console.error("Failed to load timeseries for", nexusId, err);
        }
        // Clicked a nexus point.
        // hs_actions.reset_teehr();
        // hs_actions.reset_troute();

        // const nexusId = feature.properties.id;
        // hs_actions.set_nexus_id(nexusId);
        // hs_actions.set_troute_id(nexusId);
        // setSelectedNexusId(nexusId);
        // setSelectedCatchmentId(null);

        // // When clicking a nexus point, ensure catchments remain hidden.
        // if (!isNexusHidden) {
        //   hs_actions.show_nexus_geometry();
        // }

        // if (feature.properties.ngen_usgs !== 'none') {
        //   hs_actions.set_teehr_id(feature.properties.ngen_usgs);
        // }
        // return;
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
        hs_actions.reset_teehr();
        hs_actions.reset_troute();

        const divideId = feature.properties.divide_id;
        hs_actions.set_catchment_id(divideId);
        hs_actions.set_troute_id(divideId);
        setSelectedCatchmentId(divideId);
        setSelectedNexusId(null);

        // When clicking a catchment, ensure nexus remains hidden.
        if (!isCatchmentHidden) {
          hs_actions.show_catchment_geometry();
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
    {/* Existing CONUS source (keep as-is) */}
    <Source
      id="conus"
      type="vector"
      url="pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles"
    >
    </Source>

    {/* NEW: VPU_01 pmtiles from MinIO */}
    <Source
      id="vpu01"
      type="vector"
      url={`pmtiles://${cs_state.geometry}`}
    >
      {/* Example: divides from this pmtiles */}
      <Layer
        id="divides"
        type="fill"
        source-layer="divides"
        paint={{
        'fill-color': theme === 'dark'
          ? 'rgba(238, 51, 119, 0.316)'
          : 'rgba(91, 44, 111, 0.316)',
        'fill-outline-color': theme === 'dark'
          ? 'rgba(238, 51, 119, 0.7)'
          : 'rgba(91, 44, 111, 0.7)',
        // 'fill-opacity': { stops: [[7, 0], [11, 1]] },
        }}
     />
      {/* Example: flowpaths from this pmtiles */}
      <Layer
        id="flowpaths"
        type="line"
        source-layer="flowpaths"
        paint={{
          'line-color': theme === 'dark' ? '#0077bb' : '#000000',
          'line-width': { stops: [[7, 1], [10, 2]] },
          'line-opacity': { stops: [[7, 0], [11, 1]] },
        }}
      />

    </Source>
    <Source
      id="nexus"
      type="vector"
      url={`pmtiles://${cs_state.geometry}`}
      cluster={true}
      clusterRadius={50}
      clusterMaxZoom={14}   
    >
      {nexusLayers}


    </Source>

  </Map>
  );
};

export default MapComponent;
