import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer, Popup } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import useTheme from 'hooks/useTheme';
import { getTimeseries } from "features/DataStream/lib/getTimeSeries";
import { makeGpkgUrl } from '../lib/s3Utils';
import { getCacheKey } from '../lib/opfsCache';
import { loadVpuData, getVariables } from 'features/DataStream/lib/vpuDataLoader';
import useTimeSeriesStore from '../store/timeseries';
import useDataStreamStore from '../store/datastream';
import {useLayersStore, useFeatureStore} from '../store/layers';
import { PopupContent } from './styles/styles';
import { reorderLayers } from '../lib/layers';
import { makeTitle, layerIdToFeatureType } from '../lib/utils';
import { toast } from 'react-toastify';

const onMapLoad = (event) => {
  const map = event.target;
  // Set pointer interactions
  const hoverLayers = ['divides', 'nexus-points'];
  hoverLayers.forEach((layer) => {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  });

  reorderLayers(map);
};

const MapComponent = () => {
  
  const isNexusVisible = useLayersStore((state) => state.nexus.visible);
  const isCatchmentsVisible = useLayersStore((state) => state.catchments.visible);
  const isFlowPathsVisible = useLayersStore((state) => state.flowpaths.visible);
  const isConusGaugesVisible = useLayersStore((state) => state.conus_gauges.visible)
  const enabledHovering = useLayersStore((state) => state.hovered_enabled);

  const selectedFeatureId = useTimeSeriesStore((state) => state.feature_id);
  const set_series = useTimeSeriesStore((state) => state.set_series);
  const set_feature_id = useTimeSeriesStore((state) => state.set_feature_id);
  const set_variable = useTimeSeriesStore((state) => state.set_variable);
  const set_table = useTimeSeriesStore((state) => state.set_table);
  const set_layout = useTimeSeriesStore((state) => state.set_layout);

  const nexus_pmtiles = useDataStreamStore((state) => state.nexus_pmtiles);
  const conus_pmtiles = useDataStreamStore((state) => state.community_pmtiles);
  const date = useDataStreamStore((state) => state.date);
  const model = useDataStreamStore((state) => state.model);
  const forecast = useDataStreamStore((state) => state.forecast);
  const time = useDataStreamStore((state) => state.time);
  const cycle = useDataStreamStore((state) => state.cycle);
  const set_vpu = useDataStreamStore((state) => state.set_vpu);
  const set_variables = useDataStreamStore((state) => state.set_variables);
    
  const set_hovered_feature = useFeatureStore((state) => state.set_hovered_feature);
  const hovered_feature =  useFeatureStore((state) => state.hovered_feature);
  const set_selected_feature = useFeatureStore((state) => state.set_selected_feature);
  const selectedMapFeature = useFeatureStore((state) => state.selected_feature);

  const theme = useTheme();
  const mapRef = useRef(null);
  
  const onHover = useCallback(
    (event) => {
      if (!enabledHovering){
        set_hovered_feature({});
        return;
      }
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
    [set_hovered_feature, enabledHovering]
  );

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
            selectedFeatureId
            ? ['any', ['==', ['get', 'divide_id'], selectedFeatureId]]
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
  }, [theme, selectedFeatureId, isCatchmentsVisible]);

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
        selectedFeatureId
          ? [
              'all',
              ['!', ['has', 'point_count']],     // ignore any clustered features
              ['==', ['get', 'id'], selectedFeatureId], // match the exact feature id
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
}, [isNexusVisible, theme, selectedFeatureId]);

  useEffect(() => {
    // Reset highlights when geometry layers are hidden
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);
    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current && mapRef.current.getMap
      ? mapRef.current.getMap()
      : mapRef.current;

    if (!map) return;

    reorderLayers(map);
  }, [isNexusVisible, isCatchmentsVisible, isFlowPathsVisible, isConusGaugesVisible]);
 
  useEffect(() => {
    console.log("Selected feature changed:", selectedMapFeature);
    if (!selectedFeatureId) return;

    const map = mapRef.current && mapRef.current.getMap
      ? mapRef.current.getMap()
      : mapRef.current;

    if (!map || !map.isStyleLoaded()) return;

    map.flyTo({
      center:  [selectedMapFeature.lon, selectedMapFeature.lat],
      zoom: 11,
      essential: true,
    });

  }, [selectedMapFeature, isCatchmentsVisible, isNexusVisible]);

  const layersToQuery = useMemo(() => {
    const layers = [];
    if (isNexusVisible) layers.push('nexus-points');
    if (isCatchmentsVisible) layers.push('divides');
    return layers;
  }, [isNexusVisible, isCatchmentsVisible]);

  const handleMapClick = async (event) => {
    set_feature_id(null);
    const map = event.target;

    if (layersToQuery.length === 0) return;

    const features = map.queryRenderedFeatures(event.point, { layers: layersToQuery });
    if (!features || !features.length) return;
    
    for (const feature of features) {
      const layerId = feature.layer.id;
      set_selected_feature({
        latitude: feature.geometry.coordinates[1],
        longitude: feature.geometry.coordinates[0],
        ...feature.properties
      })

      const featureIdProperty = layerIdToFeatureType(layerId);
      const unbiased_id = feature.properties[featureIdProperty];
      const id = unbiased_id.split('-')[1];
      const vpu_str = `VPU_${feature.properties.vpuid}`;
      const vpu_gpkg = makeGpkgUrl(vpu_str);
      const cacheKey = getCacheKey(model, date , forecast, cycle, time, vpu_str);
      const toastId = toast.loading(`Loading data for id: ${id}...`, {
        closeOnClick: false,
        draggable: false,
      });
      try {
        await loadVpuData(model, date, forecast, cycle, time, vpu_str, vpu_gpkg);
        const variables = await getVariables({cacheKey});
        const series = await getTimeseries(id, cacheKey, variables[0]);
        const xy = series.map(d => ({
          x: new Date(d.time),
          y: d.flow,
        }));
        set_feature_id(unbiased_id);
        set_table(cacheKey);
        set_vpu(vpu_str);
        set_variables(variables)
        set_variable(variables[0]);
        set_series(xy);
        set_layout({
          "yaxis": variables[0],
          "xaxis": "",
          "title": makeTitle(forecast, unbiased_id),
        });

        toast.update(toastId, {
          render: `Loaded data for id: ${id}`,
          type: 'success',
          isLoading: false,
          autoClose: 3000,
          closeOnClick: true,
        });        
      } catch (err) {
        toast.update(toastId, {
          render: `Failed to load data for id: ${id}`,
          type: 'error',
          isLoading: false,
          autoClose: 5000,
          closeOnClick: true,
        });
        console.error("Failed to load timeseries for", id, err);
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
      url={`pmtiles://${conus_pmtiles}`}
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

        {hovered_feature?.id && (
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
