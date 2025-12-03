import React, { useEffect, useState, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import useTheme from 'hooks/useTheme';
import { getTimeseries } from "features/DataStream/lib/getTimeSeries";
import { makeGpkgUrl, getNCFiles } from '../lib/s3Utils';
import { getCacheKey } from '../lib/opfsCache';
import { loadVpuData, getVariables } from 'features/DataStream/lib/vpuDataLoader';
import useTimeSeriesStore from '../store/timeseries';

const onMapLoad = (event) => {
  const map = event.target;

  // Set pointer interactions
  const hoverLayers = ['divides', 'nexus-points'];
  hoverLayers.forEach((layer) => {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  });

  // Bring specific layers to front
  ['nexus-points'].forEach((layerId) => {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  });

  // Ensure highlight layers are on top
  ['nexus-highlight', 'catchment-highlight'].forEach((layerId) => {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  });
};

const MapComponent = ({
  cs_context,
 }) => {
  const { state: hf_state, actions: hs_actions } = useHydroFabricContext();
  const selectedFeature = useTimeSeriesStore((state) => state.feature_id);
  const set_series = useTimeSeriesStore((state) => state.set_series);
  const set_feature_id = useTimeSeriesStore((state) => state.set_feature_id);
  const set_variable = useTimeSeriesStore((state) => state.set_variable);
  const { state: cs_state, actions: cs_actions } = cs_context();
  
  const theme = useTheme();
  const mapRef = useRef(null);
  
  const isNexusHidden = hf_state.nexus.geometry.hidden;
  const isCatchmentHidden = hf_state.catchment.geometry.hidden; // default false

  const mapStyleUrl =
    theme === 'dark'
      ? 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json'
      : 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json';


  // Memoized layer config for catchments
  const catchmentLayer = useMemo(() => {
    const divides = (
      <Layer
        id= 'divides'
        type= 'fill'
        source= 'hydrofabric'
        source-layer= 'conus_divides'
        paint= {{
          'fill-color': theme === 'dark'
            ? 'rgba(238, 51, 119, 0.316)'
            : 'rgba(91, 44, 111, 0.316)',
          'fill-outline-color': theme === 'dark'
            ? 'rgba(238, 51, 119, 0.7)'
            : 'rgba(91, 44, 111, 0.7)',
          'fill-opacity': { stops: [[7, 0], [11, 1]] },
        }} 
      /> 
    )
    const highlighted = (
      <Layer
        id="divides-highlight"
        type="fill"
        source="hydrofabric"
        source-layer="conus_divides"
        filter={
            selectedFeature
            ? ['any', ['==', ['get', 'divide_id'], selectedFeature]]
            : ['==', ['get', 'divide_id'], '']
        }
        paint= {{
          'fill-color': theme === 'dark'
            ? 'rgba(24, 21, 230, 0.32)'
            : 'rgba(5, 49, 243, 0.32)',
          'fill-outline-color': theme === 'dark'
            ? 'rgba(192, 20, 207, 0.7)'
            : 'rgba(253, 0, 253, 0.7)',
          'fill-opacity': { stops: [[7, 0], [11, 1]] },
        }} 
      />
    );

    return [ divides, highlighted ]
  }, [theme, selectedFeature]);

  // Memoized layer config for flowpaths
  const flowPathsLayer = useMemo(() => {
    const layer = (
      <Layer
        key="flowpaths"
        id="flowpaths"
        type="line"
        source="hydrofabric"
        source-layer="conus_flowpaths"
        filter={['any', ['in', 'id']]}
        paint={{
          'line-color': theme === 'dark' ? '#0077bb' : '#000000',
          'line-width': { stops: [[7, 1], [10, 2]] },
          'line-opacity': { stops: [[7, 0], [11, 1]] },
        }}
      />
    );
    return layer;
  }, [theme]);

  // Memoized layer config for gauges
  const conusGaugesLayer = useMemo(() => {
    const layer = (
      <Layer
        key="conus-gauges"
        id="conus-gauges"
        type="circle"
        source="hydrofabric"
        source-layer="conus_gages"
        filter={['any', ['in', 'nex_id']]}
        paint={{
          'circle-radius': { stops: [[3, 2], [11, 5]] },
          'circle-color': theme === 'dark' ? '#c8c8c8' : '#646464',
          'circle-opacity': { stops: [[3, 0], [9, 1]] },
        }}
      />
    )
    return layer;
  }, [theme]);


const nexusLayers = useMemo(() => {
  if (isNexusHidden) return null;

  const pointsLayer = (
    <Layer
      key="nexus-points"
      id="nexus-points"
      type="circle"
      source="nexus"
      source-layer="nexus"
      filter={['!', ['has', 'point_count']]}
      minzoom={5}
      // maxzoom={16}
      paint={{
        'circle-radius': 7,
        'circle-color': theme === 'dark' ? '#4f5b67' : '#1f78b4',
        'circle-stroke-width': 1,
        'circle-stroke-color': theme === 'dark' ? '#e9ecef' : '#ffffff',
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
      // Optional: ensure it's drawn above the normal points layer
      // beforeId="nexus-points"
      filter={
        selectedFeature
          ? [
              'all',
              ['!', ['has', 'point_count']],     // ignore any clustered features
              ['==', ['get', 'id'], selectedFeature], // match the exact feature id
            ]
          : ['boolean', false]                    // match nothing when not selected
      }
      paint={{
        'circle-radius': 10,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
        'circle-color': '#ff0000',
      }}
    />
  );




  return [pointsLayer, nexusHighlightLayer];
}, [isNexusHidden, theme, selectedFeature]);

  useEffect(() => {
    // Reset highlights when geometry layers are hidden
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);
    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);
  
  // ------------------------------------
  // ON CLICK: update state based on clicked layer
  // ------------------------------------
  const handleMapClick = async (event) => {
    console.log('Map clicked at:', event);
    set_feature_id(null);
    const map = event.target;
    // Build layersToQuery based on current hidden states
    const layersToQuery = [];
    if (!isNexusHidden) {
      layersToQuery.push('nexus-points')
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
      if (layerId === 'nexus-points'){
        const unbiased_id = feature.properties.id;
        const id = unbiased_id.split('-')[1];
        set_feature_id(unbiased_id);

        console.log('Clicked nexus feature with id:', id);
        const vpu_str = `VPU_${feature.properties.vpuid}`;
        cs_actions.set_vpu(vpu_str);

        try {
          const nc_files_parsed = await getNCFiles(cs_state.date , cs_state.forecast, cs_state.cycle, cs_state.time, vpu_str);
          const vpu_gpkg = makeGpkgUrl(vpu_str);
          const cacheKey = getCacheKey(cs_state.date , cs_state.forecast, cs_state.cycle, cs_state.time, vpu_str);
        
          await loadVpuData({
            cacheKey: cacheKey,
            nc_files: nc_files_parsed,
            vpu_gpkg,
          });

          const variables = await getVariables({cacheKey});
          set_variable(variables[0]); // Set to first variable by default
          
          const series = await getTimeseries(id, cacheKey, variables[0]);
          const xy = series.map(d => ({
            x: new Date(d.time),
            y: d.flow,
          }));
          
          set_series(xy);
          console.log("Flow timeseries for", id, xy);
        } catch (err) {
          console.error("Failed to load timeseries for", id, err);
        }

      }
      
      if (layerId === 'divides') {
        // Clicked a catchment.
        const id = feature.properties.divide_id;
        set_feature_id(id);
        console.log(id)
      }
      break;
    }
  };


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
      {catchmentLayer}
      {flowPathsLayer}
      {conusGaugesLayer}

    </Source>

    <Source
      id="nexus"
      type="vector"
      url={`pmtiles://${cs_state.geometry}`}
    >
      {nexusLayers}
    </Source>

  </Map>
  );
};

export default MapComponent;
