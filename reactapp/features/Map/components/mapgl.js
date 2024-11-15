// MapComponent.jsx
import React, { useEffect, useState, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import { Protocol } from 'pmtiles';
import appAPI from 'services/api/app';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';


  // Define the onMapLoad function
  const onMapLoad = (event) => {
    const map = event.target;
    const hoverLayers = ['selected-catchments', 'catchments-layer', 'unclustered-point', 'clusters'];

    hoverLayers.forEach(layer => {
      // Change cursor to pointer on mouse enter
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      // Revert cursor to default on mouse leave
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
      });
    });
    if (map.getLayer('catchments')) {
      // Set a filter that matches no features
      map.setFilter('catchments', ['any', ['in', 'divide_id', ""]]);
      console.log("Base 'catchments' layer has been filtered out.");
    } else {
      console.log("Base 'catchments' layer not found.");
    }
  };


// Define the style for the Nexus Layer
const clusterLayer = {
  id: 'clusters',
  type: 'circle',
  source: 'nexus-points',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': [
      'step',
      ['get', 'point_count'],
      '#51bbd6', 10,
      '#f1f075', 50,
      '#f28cb1'
    ],
    'circle-radius': [
      'step',
      ['get', 'point_count'],
      15, 10,
      25, 50,
      35
    ],
  },
};

const unclusteredPointLayer = {
  id: 'unclustered-point',
  type: 'circle',
  source: 'nexus-points',
  filter: ['!', ['has', 'point_count']], // Non-clustered points do not have `point_count`
  paint: {
    'circle-color': '#007cbf', // Fill color for the point
    'circle-radius': 7,
    'circle-stroke-width': 2, // Width of the stroke
    'circle-stroke-color': '#ff0000', // Red color for the stroke
  },
};

const MapComponent = () => {
  const { actions: hydroFabricActions } = useHydroFabricContext();
  const [nexusPoints, setNexusPoints] = useState(null);
  const [catchmentConfig, setCatchmentConfig] = useState(null);

  const mapRef = useRef(null);

  useEffect(() => {
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    appAPI.getGeoSpatialData().then(response => {
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
        source: 'conus',
        'source-layer': 'catchments', // Replace with actual source layer name
        filter: ['any', ['in', 'divide_id', ...response.catchments]],
        "paint": {
          "fill-color": ["rgba", 0, 0, 0, 0],
          "fill-outline-color": ["rgba", 1, 1, 1, 0.5],
          "fill-opacity": { "stops": [[7, 0], [11, 1]] }
        }
      };
      setCatchmentConfig(catchmentLayerConfig);


    }).catch(error => {
      console.log(error);
    });

    return () => {
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);


  // Define the PMTiles source URL
  const pmtilesUrl =
    'pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/conus.pmtiles';

    const handleMapClick = async (event) => {
      const map = event.target;
      // Include both 'catchments-layer' and the nexus point layers in the array
      const features = map.queryRenderedFeatures(event.point, {
        layers: ['selected-catchments', 'catchments-layer', 'unclustered-point', 'clusters'],
      });
    
      if (features.length > 0) {
        // Loop through all features at the click point
        for (const feature of features) {
          const layerId = feature.layer.id;
          console.log('Clicked on layer:', layerId);
          console.log('Feature properties:', feature.properties);
          
          if (layerId === 'catchments-layer') {
            // Handle click on 'catchments-layer'
            hydroFabricActions.reset_teehr();
            hydroFabricActions.set_catchment_id(feature.properties.divide_id);
            return;
          } else if (layerId === 'unclustered-point') {
            // Handle click on individual nexus points
            hydroFabricActions.reset_teehr();
            const nexus_id = feature.properties.id;
            hydroFabricActions.set_nexus_id(nexus_id);
            if (feature.properties.ngen_usgs !== "none") {
              hydroFabricActions.set_teehr_id(feature.properties.ngen_usgs);
            }
            return;
          } else if (layerId === 'clusters') {
            const clusterId = feature.properties.cluster_id;
            const zoom = await map.getSource('nexus-points').getClusterExpansionZoom(clusterId);
            map.flyTo({
              center: feature.geometry.coordinates,
              zoom: zoom,
              speed: 1.2, // Adjust speed of zoom animation (higher is slower)
              curve: 1 // Controls zoom "smoothness"
            });

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
      mapStyle="https://communityhydrofabric.s3.us-east-1.amazonaws.com/style.json"
      onClick={handleMapClick}
      onLoad={onMapLoad}
    >
      {/* Add the PMTiles source */}
      <Source id="conus" type="vector" url={pmtilesUrl}>
        {/* Add the layer that uses the source */}
        <Layer {...catchmentConfig} />

      </Source>


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
          <Layer {...unclusteredPointLayer} />
        </Source>
      )}
    </Map>
  );
};

export default MapComponent;
