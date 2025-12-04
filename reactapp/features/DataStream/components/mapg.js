import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer, Popup } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import useTheme from 'hooks/useTheme';
import { getTimeseries } from "features/DataStream/lib/getTimeSeries";
import { makeGpkgUrl, getNCFiles } from '../lib/s3Utils';
import { getCacheKey } from '../lib/opfsCache';
import { loadVpuData, getVariables } from 'features/DataStream/lib/vpuDataLoader';
import useTimeSeriesStore from '../store/timeseries';
import useDataStreamStore from '../store/datastream';
import {useLayersStore, useFeatureStore} from '../store/layers';
import { PopupContent } from './StyledComponents/ts';

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

const MapComponent = () => {
  
  const isNexusVisible = useLayersStore((state) => state.nexus.visible);
  const isCatchmentsVisible = useLayersStore((state) => state.catchments.visible);
  const isFlowPathsVisible = useLayersStore((state) => state.flowpaths.visible);
  const isConusGaugesVisible = useLayersStore((state) => state.conus_gauges.visible)
  const selectedFeature = useTimeSeriesStore((state) => state.feature_id);
  const set_series = useTimeSeriesStore((state) => state.set_series);
  const set_feature_id = useTimeSeriesStore((state) => state.set_feature_id);
  const set_variable = useTimeSeriesStore((state) => state.set_variable);
  const set_table = useTimeSeriesStore((state) => state.set_table);

  const nexus_pmtiles = useDataStreamStore((state) => state.nexus_pmtiles);
  const date = useDataStreamStore((state) => state.date);
  const forecast = useDataStreamStore((state) => state.forecast);
  const time = useDataStreamStore((state) => state.time);
  const cycle = useDataStreamStore((state) => state.cycle);
  const set_vpu = useDataStreamStore((state) => state.set_vpu);
  const set_variables = useDataStreamStore((state) => state.set_variables);
  
  const set_hovered_feature = useFeatureStore((state) => state.set_hovered_feature);
  const hovered_feature =  useFeatureStore((state) => state.hovered_feature);
  
  const theme = useTheme();
  const mapRef = useRef(null);
  
  const onHover = useCallback(
    (event) => {
      const { features, lngLat } = event;

      if (!features || features.length === 0) {
        // Clear popup when not over any feature
        set_hovered_feature({});
        return;
      }

      const feature = features[0];
      const layerId = feature.layer.id;
      

      let id =
        layerId === 'divides'
          ? feature.properties?.divide_id
          : feature.properties?.id;

      if (!id) {
        set_hovered_feature({});
        return;
      }

      set_hovered_feature({
        longitude: lngLat.lng,
        latitude: lngLat.lat,
        // id,
        ...feature.properties
      });
      
    },
    [set_hovered_feature]
  );

  const hoveredId = hovered_feature?.id || '';

  const mapStyleUrl =
    theme === 'dark'
      ? 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json'
      : 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json';


  // Memoized layer config for catchments
  const catchmentLayer = useMemo(() => {
    if (!isCatchmentsVisible) return null;
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
        beforeId='divides'
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
  }, [theme, selectedFeature, isCatchmentsVisible]);

  // Memoized layer config for flowpaths
  const flowPathsLayer = useMemo(() => {
    if (!isFlowPathsVisible) return null
    const layer = (
      <Layer
        key="flowpaths"
        id="flowpaths"
        type="line"
        source="hydrofabric"
        source-layer="conus_flowpaths"
        // filter={['any', ['in', 'id']]}
        paint={{
          'line-color': theme === 'dark' ? '#0077bb' : '#000000',
          'line-width': { stops: [[7, 1], [10, 2]] },
          'line-opacity': { stops: [[7, 0], [11, 1]] },
        }}
      />
    );
    return layer;
  }, [theme, isFlowPathsVisible]);

  // Memoized layer config for gauges
  const conusGaugesLayer = useMemo(() => {
    if (!isConusGaugesVisible) return null;
    const layer = (
      <Layer
        key="conus-gauges"
        id="conus-gauges"
        type="circle"
        source="hydrofabric"
        source-layer="conus_gages"
        paint={{
          'circle-radius': { stops: [[3, 2], [11, 5]] },
          'circle-color': theme === 'dark' ? '#c8c8c8' : '#646464',
          'circle-opacity': { stops: [[3, 0], [9, 1]] },
        }}
      />
    )
    return layer;
  }, [theme, isConusGaugesVisible]);


const nexusLayers = useMemo(() => {
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
      beforeId="nexus-points"
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
}, [isNexusVisible, theme, selectedFeature]);

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
    if (isNexusVisible) {
      layersToQuery.push('nexus-points')
    }
    if (isCatchmentsVisible) {
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
        set_vpu(vpu_str);

        try {
          const nc_files_parsed = await getNCFiles(date , forecast, cycle, time, vpu_str);
          const vpu_gpkg = makeGpkgUrl(vpu_str);
          const cacheKey = getCacheKey(date , forecast, cycle, time, vpu_str);
        
          await loadVpuData({
            cacheKey: cacheKey,
            nc_files: nc_files_parsed,
            vpu_gpkg,
          });
          set_table(cacheKey)
          const variables = await getVariables({cacheKey});
          set_variables(variables)
          set_variable(variables[0]);
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
    onMouseMove={onHover}
    interactiveLayerIds={['divides', 'nexus-points', 'flowpaths', 'conus-gauges']}
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
      url={`pmtiles://${nexus_pmtiles}`}
    >
      {nexusLayers}
    </Source>

        {hoveredId && (
          <Popup
            longitude={hovered_feature.longitude}
            latitude={hovered_feature.latitude}
            offset={[0, -10]}
            closeButton={false}
          >
            <PopupContent>
              <div className="popup-title">Feature</div>

              {
                Object.keys(hovered_feature).map((key) => {
                 return(
                  <div className="popup-row" key={key}>
                    <span className="popup-label">{key}</span>
                    <span className="popup-value">{hovered_feature[key]}</span>
                  </div>
                 )
                })
              }
            </PopupContent>            

          </Popup>
        )}

  </Map>
  );
};

export default MapComponent;
