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
    const hoverLayers = ['catchments-layer', 'unclustered-point', 'clusters'];

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
    // Ensure 'unclustered-point' and 'clusters' layers are rendered on top of others
    if (map.getLayer('unclustered-point')) {
      map.moveLayer('unclustered-point');
    }
    if (map.getLayer('clusters')) {
      map.moveLayer('clusters');
    }

    if (map.getLayer('catchments')) {
      map.setFilter('catchments', ['any', ['in', 'divide_id', ""]]);
      console.log("Base 'catchments' layer has been filtered out.");
    }
    if(map.getLayer('flowpaths')){
      map.setFilter('flowpaths', ['any', ['in', 'id', ""]]);
      console.log("Base 'flowpaths' layer has been filtered out.");
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
      '#6610f2', 50,
      '#20c997'
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
    'circle-color': '#2c3e50', // Fill color for the point
    'circle-radius': 7,
    'circle-stroke-width': 2, // Width of the stroke
    'circle-stroke-color': '#e9ecef', // Red color for the stroke
  },
};

const teerhAvailableLayer = {
  id: "teerh-available-points",
  type: "circle",
  source: "teerh-available-points",
  paint: {
    "circle-color": "rgba(0, 0, 0, 0)", // Fully transparent fill
    "circle-radius": 9,
    "circle-stroke-width": 2,
    "circle-stroke-color": "red", // Stroke color
  },
};


const MapComponent = () => {
  const { actions: hydroFabricActions } = useHydroFabricContext();
  const [nexusPoints, setNexusPoints] = useState(null);
  const [teerhAvailableNexusPoints, setTeerhAvailableNexusPoints] = useState(null);
  const [catchmentConfig, setCatchmentConfig] = useState(null);
  const [flowPathsConfig, setFlowPathsConfig] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    const protocol = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    appAPI.getGeoSpatialData().then(response => {
      const { nexus, bounds,teerh } = response;
      setNexusPoints(nexus);
      console.log('Nexus points:', nexus);

      setTeerhAvailableNexusPoints(teerh);
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
          "fill-color": ["rgba", 238, 51, 119, 0.316],
          "fill-outline-color": ["rgba", 238, 51, 119, 0.7],
          "fill-opacity": { "stops": [[7, 0], [11, 1]] }
        }
      };
      setCatchmentConfig(catchmentLayerConfig);

      const flowPathsLayerConfig = {
        "id": "flowpaths-layer",
        "type": "line",
        "source": "conus",
        "source-layer": "flowpaths",
        "layout": {},
        "paint": {
            "line-color": ["rgba", 0, 119, 187, 1],
            "line-width": { "stops": [[7, 1], [10, 2]] },
            "line-opacity": { "stops": [[7, 0], [11, 1]] }
        },
        "filter": ["any",["in", "id", ...response.flow_paths_ids]] // Replace with actual
      }
      
      setFlowPathsConfig(flowPathsLayerConfig);


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
    
      // Prioritize clicking on 'unclustered-point' and 'clusters' layers first
      const features = map.queryRenderedFeatures(event.point, {
        layers: ['unclustered-point', 'clusters', 'catchments-layer'],
      });
    
      if (features.length > 0) {
        // Loop through all features at the click point
        for (const feature of features) {
          const layerId = feature.layer.id;
          console.log('Clicked on layer:', layerId);
          console.log('Feature properties:', feature.properties);
          
          // Priority click handling for 'unclustered-point' and 'clusters'
          if (layerId === 'unclustered-point') {
            hydroFabricActions.reset_teehr();
            const nexus_id = feature.properties.id;
            hydroFabricActions.set_nexus_id(nexus_id);
            if (feature.properties.ngen_usgs !== "none") {
              hydroFabricActions.set_teehr_id(feature.properties.ngen_usgs);
            }
            return; // Exit after handling unclustered point click
          } else if (layerId === 'clusters') {
            const clusterId = feature.properties.cluster_id;
            const zoom = await map.getSource('nexus-points').getClusterExpansionZoom(clusterId);
            map.flyTo({
              center: feature.geometry.coordinates,
              zoom: zoom,
              speed: 1.2,
              curve: 1,
            });
            return; // Exit after handling cluster click
          }
          
          // Handle other layers, like 'catchments-layer', only if unclustered/clustered layers weren't clicked
          if (layerId === 'catchments-layer') {
            hydroFabricActions.reset_teehr();
            hydroFabricActions.set_catchment_id(feature.properties.divide_id);
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
            {teerhAvailableNexusPoints && (
        <Source
          id="teerh-available-points"
          type="geojson"
          data={teerhAvailableNexusPoints}
        >
          <Layer {...teerhAvailableLayer} />
        </Source>
      )}
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



      {/* Add the PMTiles source */}
      <Source id="conus" type="vector" url={pmtilesUrl}>
        {/* Add the layer that uses the source */}
        <Layer {...catchmentConfig} />
        <Layer {...flowPathsConfig} />

      </Source>
    </Map>
  );
};

export default MapComponent;
