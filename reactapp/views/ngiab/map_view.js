import React, { Fragment, useEffect } from 'react';
import appAPI from 'services/api/app';
import { useMapContext } from 'features/Map/hooks/useMapContext';
import {Stroke, Style} from 'ol/style.js';
import {createVectorLayer} from 'features/Map/lib/mapUtils';

const baseMapLayerURL= 'https://server.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer';
const catchmentLayersURL = 'https://ahocevar.com/geoserver/wms';

const layersArray = [
    {
        layerType: 'OlTileLayer',
        options: 
        {
            sourceType: 'ArcGISRestTile',
            url: baseMapLayerURL,
            // all the params for the source goes here
            params: {
                LAYERS: 'topp:states',
                Tiled: true,
            },
            // the rest of the attributes are for the definition of the layer
            name: "baseMapLayer",
            zIndex: 1
        },
            extraProperties: {
            events: [],
            priority: 1      
        }    
    },
    // // catchment layer
    // {
    //     layerType: 'OlTileLayer',
    //     options: 
    //     {
    //         sourceType: 'WMSTile',
    //         url: catchmentLayersURL,
    //         // all the params for the source goes here
    //         params: {
    //             LAYERS: 'topp:states',
    //             Tiled: true,
    //         },
    //         // the rest of the attributes are for the definition of the layer
    //         name: "baseMapLayer",

    //     },
    //         extraProperties: {
    //         events: [],
    //         priority: 1      
    //     }    
    // }
]

const geojsonObject = {
    'type': 'FeatureCollection',
    'crs': {
      'type': 'name',
      'properties': {
        'name': 'EPSG:3857',
      },
    },
    'features': [
      {
        'type': 'Feature',
        'geometry': {
          'type': 'Point',
          'coordinates': [0, 0],
        },
      },
      {
        'type': 'Feature',
        'geometry': {
          'type': 'LineString',
          'coordinates': [
            [4e6, -2e6],
            [8e6, 2e6],
          ],
        },
      },
      {
        'type': 'Feature',
        'geometry': {
          'type': 'LineString',
          'coordinates': [
            [4e6, 2e6],
            [8e6, -2e6],
          ],
        },
      },
      {
        'type': 'Feature',
        'geometry': {
          'type': 'Polygon',
          'coordinates': [
            [
              [-5e6, -1e6],
              [-3e6, -1e6],
              [-4e6, 1e6],
              [-5e6, -1e6],
            ],
          ],
        },
      },
      {
        'type': 'Feature',
        'geometry': {
          'type': 'MultiLineString',
          'coordinates': [
            [
              [-1e6, -7.5e5],
              [-1e6, 7.5e5],
            ],
            [
              [1e6, -7.5e5],
              [1e6, 7.5e5],
            ],
            [
              [-7.5e5, -1e6],
              [7.5e5, -1e6],
            ],
            [
              [-7.5e5, 1e6],
              [7.5e5, 1e6],
            ],
          ],
        },
      },
      {
        'type': 'Feature',
        'geometry': {
          'type': 'MultiPolygon',
          'coordinates': [
            [
              [
                [-5e6, 6e6],
                [-3e6, 6e6],
                [-3e6, 8e6],
                [-5e6, 8e6],
                [-5e6, 6e6],
              ],
            ],
            [
              [
                [-2e6, 6e6],
                [0, 6e6],
                [0, 8e6],
                [-2e6, 8e6],
                [-2e6, 6e6],
              ],
            ],
            [
              [
                [1e6, 6e6],
                [3e6, 6e6],
                [3e6, 8e6],
                [1e6, 8e6],
                [1e6, 6e6],
              ],
            ],
          ],
        },
      },
      {
        'type': 'Feature',
        'geometry': {
          'type': 'GeometryCollection',
          'geometries': [
            {
              'type': 'LineString',
              'coordinates': [
                [-5e6, -5e6],
                [0, -5e6],
              ],
            },
            {
              'type': 'Point',
              'coordinates': [4e6, -5e6],
            },
            {
              'type': 'Polygon',
              'coordinates': [
                [
                  [1e6, -6e6],
                  [3e6, -6e6],
                  [2e6, -4e6],
                  [1e6, -6e6],
                ],
              ],
            },
          ],
        },
      },
    ],
  };

  let testLayerParams = {
    geojsonLayer: geojsonObject, // This should be your GeoJSON data
    nameLayer: 'Nexus Layer',
    styleLayer: new Style({
        stroke: new Stroke({
          color: 'green',
          width: 1,
        })
    }), // This should be a style object for your layer
    layerEvents: [
        {
            'type': 'click', 
            'handler': (layer,event)=>{
                console.log(layer,event)
            }
        }
    ], // This should be an object with any events you want to attach to the layer
    priorityLayer: 1,
    zIndexLayer: 3
}


let nexusLayerParams = {
    geojsonLayer: geojsonObject, // This should be your GeoJSON data
    nameLayer: 'Nexus Layer',
    styleLayer: new Style({
        stroke: new Stroke({
          color: 'green',
          width: 1,
        })
    }), // This should be a style object for your layer
    layerEvents: [
        {
            'type': 'click', 
            'handler': (layer,event)=>{
                console.log(layer,event)
            }
        }
    ], // This should be an object with any events you want to attach to the layer
    priorityLayer: 1,
    zIndexLayer: 3
}

const MapView = () => {
  const {actions: mapActions } = useMapContext();


  useEffect(() => {

    // 
    appAPI.getNexusGeoJson().then(response => {
        console.log(response)
        // Define the parameters for the layer
        nexusLayerParams['geojsonLayer']=response;
        // nexusLayerParams['geojsonLayer']['crs']['properties']['name'] = 'EPSG:3857';
        const nexusLayer = createVectorLayer(nexusLayerParams);
        console.log(nexusLayer)
        mapActions.addLayer(nexusLayer);
    }).catch(error => {
        console.log(error)
    })

    //adding layers
    layersArray.forEach(layer => {
      mapActions.addLayer(layer);
    })
    // remove the layers wheen the component unmounts
    return () => {

      //delete added layers when unmounting
      layersArray.forEach(layer => {
        mapActions.delete_layer_by_name(layer.options.name)
      })
      mapActions.delete_layer_by_name('Nexus Layer')
    }


  }, []);


  
  return (
    <Fragment>
    </Fragment>
  );
};

export default MapView;
