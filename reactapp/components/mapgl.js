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
  const layerConfig = {
    id: 'conus-layer',
    type: 'fill',
    source: 'conus',
    'source-layer': 'conus-layer-name', // Replace with actual source layer name
    paint: {
      'fill-color': '#088',
      'fill-opacity': 0.8,
    },
  };

  

const MapComponent = () => {
  const {actions: hydroFabricActions } = useHydroFabricContext(); 
  const [nexusPoints, setNexusPoints] = useState(null);

  // PMTiles protocol setup
  useEffect(() => {
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    appAPI.getNexusGeoJson().then(response => {
        console.log(response.geojson)
        setNexusPoints(response.geojson);
    }).catch(error => {
        console.log(error)
    })

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
      layers: ['conus-layer', 'nexus-layer'],
    });
  
    if (features.length > 0) {
      // Loop through all features at the click point
      for (const feature of features) {
        const layerId = feature.layer.id;
        console.log('Feature properties:', feature.properties);
        if (layerId === 'conus-layer') {
          // Handle click on 'conus-layer'
          console.log('Clicked on conus-layer');
          // Implement interaction logic specific to 'conus-layer' here
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
        <Layer {...layerConfig} />
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
