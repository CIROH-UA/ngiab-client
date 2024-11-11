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

  
// Define the layer configuration BaseMap
  const catchmentLayerConfig = {
    id: 'catchments-layer',
    type: 'fill',
    source: 'conus',
    'source-layer': 'catchments', // Replace with actual source layer name
    "paint": {
      "fill-color": ["rgba", 0, 0, 0, 0],
      "fill-outline-color": ["rgba", 1, 1, 1, 0.5],
      "fill-opacity": { "stops": [[7, 0], [11, 1]] }
    }
  };

  

const MapComponent = () => {
  const {actions: hydroFabricActions } = useHydroFabricContext(); 
  const [nexusPoints, setNexusPoints] = useState(null);
  const [selectedCatchmentsConfig, setSelectedCatchmentsConfig] = useState(null);

  // PMTiles protocol setup
  useEffect(() => {
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    appAPI.getGeoSpatialData().then(response => {
        console.log(response)
        setNexusPoints(response.nexus);
        const selectedCatchmentLayerConfig = {
          id: 'selected-catchments-layer',
          type: 'fill',
          source: 'conus',
          'source-layer': 'catchments', // Replace with actual source layer name
          filter: ['in', 'divide_id', ['literal', response.catchments]],
          "paint": {
            "fill-color": ["rgba", 238, 51, 119, 0.316],
            "fill-outline-color": ["rgba", 238, 51, 119, 0.7],
            "fill-opacity": { "stops": [[7, 0], [11, 1]] }
          }
        };
        setSelectedCatchmentsConfig(selectedCatchmentLayerConfig);

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
      layers: ['catchments-layer', 'nexus-layer', 'selected-catchments-layer'],
    });
  
    if (features.length > 0) {
      // Loop through all features at the click point
      for (const feature of features) {
        const layerId = feature.layer.id;
        console.log('Clicked on layer:', layerId);
        console.log('Feature properties:', feature.properties);
        if (layerId === 'catchments-layer') {
          // Handle click on 'conus-layer'
          console.log('Clicked on catchments-layer');
          // map.setFilter('catchments', ['any', ['in', 'divide_id', ['literal', catchments]]])
          // Implement interaction logic specific to 'conus-layer' here
          hydroFabricActions.reset_teehr();
          hydroFabricActions.set_catchment_id(feature.properties.divide_id);
        } else if (layerId === 'nexus-layer') {
          // Handle click on 'nexus-layer'
          console.log('Clicked on nexus-layer');
          hydroFabricActions.reset_teehr();
          var nexus_id = feature.properties.id;
          hydroFabricActions.set_nexus_id(nexus_id);
          if (feature.ngen_usgs != "none"){
            hydroFabricActions.set_teehr_id(feature.properties.ngen_usgs);
          }
        }
        else if (layerId === 'selected-catchments-layer'){
          console.log('Clicked on selected-catchments-layer');
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
    >
      {/* Add the PMTiles source */}
      <Source id="conus" type="vector" url={pmtilesUrl}>
        {/* Add the layer that uses the source */}
        <Layer {...catchmentLayerConfig} />
        <Layer {...selectedCatchmentsConfig} />
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
