// MapComponent.jsx
import React, { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import appAPI from 'services/api/app';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';

// Define the style for the Nexus Layer
const nexusLayer = {
    id: 'nexus-layer',
    type: 'circle',
    source: 'nexus-points',
    paint: {
      'circle-radius': 5,
      'circle-color': '#007cbf',
      'circle-stroke-color': '#ffffff', // Stroke color (e.g., white)
      'circle-stroke-width': 2,         // Stroke width in pixels
    },
  };

  const onMapLoad = (event) => {
    const map = event.target;
  
    if (map.getLayer('catchments')) {
      // Set a filter that matches no features
      map.setFilter('catchments',  ['any', ['in', 'divide_id', ""]]);
      // map.setFilter('flowpaths',  ["any",["in", "id", ""]]);
      console.log("Base 'catchments' layer has been filtered out.");
    } else {
      console.log("Base 'catchments' layer not found.");
    }
  };

const MapComponent = () => {
  const {actions: hydroFabricActions } = useHydroFabricContext(); 
  const [nexusPoints, setNexusPoints] = useState(null);
  const [filteredCatchmentsConfig, setFilteredCatchmentsConfig] = useState(null);
  const [catchmentConfig, setCatchmentConfig] = useState(null);
  const [flowpaths, setFlowpaths] = useState(null);
  const [filteredFlowpaths, setfilteredFlowpaths] = useState(null);

  // PMTiles protocol setup
  useEffect(() => {
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    appAPI.getGeoSpatialData().then(response => {
        console.log(response)
        setNexusPoints(response.nexus);
        console.log(['in', 'divide_id', ...response.catchments])
        // const catchmentLayerConfig = {
        //   id: 'catchments-layer',
        //   type: 'fill',
        //   source: 'conus',
        //   'source-layer': 'catchments', // Replace with actual source layer name
        //   filter: ['any', ['in', 'divide_id', ...response.catchments]],
        //   "paint": {
        //     "fill-color": ["rgba", 0, 0, 0, 0],
        //     // "fill-outline-color": ["rgba", 238, 51, 119, 0.7],
        //     "fill-opacity": { "stops": [[7, 0], [11, 1]] }
        //   }
        // };
        // setCatchmentConfig(catchmentLayerConfig);
        const selectedCatchmentLayerConfig = {
          id: 'filtered-catchments-layer',
          type: 'line',
          source: 'conus',
          'source-layer': 'catchments', // Replace with actual source layer name
          filter: ['in', 'divide_id', ...response.catchments],
          paint: {
            'line-color': ['rgba', 238, 51, 119, 0.7],
            'line-width': 2, // Adjust this value to make the outline thicker
          },
        };
        setFilteredCatchmentsConfig(selectedCatchmentLayerConfig);

        const flowpathsLayerConfig = {
          id: 'flowpaths-layer',
          type: 'fill',
          source: 'conus',
          'source-layer': 'flowpaths', // Replace with actual source layer name
          filter: ['any', ['in', 'divide_id', ...response.catchments]],
          "paint": {
            "line-color": ["rgba", 0, 119, 187, 1],
            "line-width": { "stops": [[7, 1], [10, 2]] },
            "line-opacity": { "stops": [[7, 0], [11, 1]] }
          },
        };
        setFlowpaths(flowpathsLayerConfig);

        const filteredFlowpathsLayerConfig = {
          id: 'selected-flowpaths-layer',
          type: 'fill',
          source: 'conus',
          'source-layer': 'flowpaths', // Replace with actual source layer name
          filter: ['any', ['in', 'divide_id', ...response.catchments]],
          "paint": {
            "line-color": ["rgba", 0, 119, 187, 1],
            "line-width": { "stops": [[7, 1], [10, 2]] },
            "line-opacity": { "stops": [[7, 0], [11, 1]] }
          },
        };
        setfilteredFlowpaths(filteredFlowpathsLayerConfig);



    }).catch(error => {
        console.log(error)
    });
    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);

  // Define the PMTiles source URL
  const pmtilesUrl =
    'pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/conus.pmtiles';


  // Handle click events
// Handle click events
const handleMapClick = (event) => {
    const map = event.target;
    
    // Include both 'conus-layer' and 'nexus-layer' in the layers array
    const features = map.queryRenderedFeatures(event.point, {
      layers: ['filtered-catchments-layer', 'nexus-layer'],
    });
  
    if (features.length > 0) {
      // Loop through all features at the click point
      console.log(features.length)
      
      for (const feature of features) {
        const layerId = feature.layer.id;
        console.log('Clicked on layer:', layerId);
        console.log('Feature properties:', feature.properties);
        if (layerId === 'filtered-catchments-layer') {
          // Handle click on 'conus-layer'
          console.log('Clicked on filtered-catchments-layer');
          hydroFabricActions.reset_teehr();
          hydroFabricActions.set_catchment_id(feature.properties.divide_id);
          return
        } else if (layerId === 'nexus-layer') {
          // Handle click on 'nexus-layer'
          console.log('Clicked on nexus-layer');
          hydroFabricActions.reset_teehr();
          var nexus_id = feature.properties.id;
          hydroFabricActions.set_nexus_id(nexus_id);
          if (feature.ngen_usgs != "none"){
            hydroFabricActions.set_teehr_id(feature.properties.ngen_usgs);
          }
          return
        }
      }
    }
  };
  return (
    <Map
      initialViewState={{
        longitude: -96,
        latitude: 40,
        zoom: 4,
      }}
      style={{ width: '100%', height: '100%' }}
      mapLib={maplibregl}
      mapStyle="https://communityhydrofabric.s3.us-east-1.amazonaws.com/style.json"
      onClick={handleMapClick}
      onLoad={onMapLoad}
    >
      {/* Add the PMTiles source */}
      <Source id="conus" type="vector" url={pmtilesUrl}>
        {/* Add the layer that uses the source */}
        {/* <Layer {...catchmentConfig} /> */}
        <Layer {...filteredCatchmentsConfig} />
        {/* <Layer {...flowpaths} /> */}
        {/* <Layer {...filteredFlowpaths} /> */}

      </Source>
      {nexusPoints && (
        <Source id="nexus-points" type="geojson" data={nexusPoints}>
            <Layer {...nexusLayer} />
        </Source>
        )}
    </Map>
  );
};

export default MapComponent;
