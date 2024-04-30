import { OlImageTileLayer, OlTileLayer, VectorLayer } from './layers/layers';
import { ArcGISRestTile, OSMWMSTile, TileImageArcGISRest, WMSTile, VectorSourceLayer,ClusterSource } from './source/sources';
// import GeoJSON from 'ol/format/GeoJSON';
// import {
//     Circle as CircleStyle,
//     Fill,
//     Stroke,
//     Style,
//     Text,
//   } from 'ol/style';
  
// const image = new CircleStyle({
//     radius: 5,
//     fill: null,
//     stroke: new Stroke({color: 'red', width: 1}),
//   });
  
// const styles = {
// 'Point': new Style({
//     image: image,
// }),
// 'LineString': new Style({
//     stroke: new Stroke({
//     color: 'green',
//     width: 1,
//     }),
// }),
// 'MultiLineString': new Style({
//     stroke: new Stroke({
//     color: 'green',
//     width: 1,
//     }),
// }),
// 'MultiPoint': new Style({
//     image: image,
// }),
// 'MultiPolygon': new Style({
//     stroke: new Stroke({
//     color: 'yellow',
//     width: 1,
//     }),
//     fill: new Fill({
//     color: 'rgba(255, 255, 0, 0.1)',
//     }),
// }),
// 'Polygon': new Style({
//     stroke: new Stroke({
//     color: 'blue',
//     lineDash: [4],
//     width: 3,
//     }),
//     fill: new Fill({
//     color: 'rgba(0, 0, 255, 0.1)',
//     }),
// }),
// 'GeometryCollection': new Style({
//     stroke: new Stroke({
//     color: 'magenta',
//     width: 2,
//     }),
//     fill: new Fill({
//     color: 'magenta',
//     }),
//     image: new CircleStyle({
//     radius: 10,
//     fill: null,
//     stroke: new Stroke({
//         color: 'magenta',
//     }),
//     }),
// }),
// 'Circle': new Style({
//     stroke: new Stroke({
//     color: 'red',
//     width: 2,
//     }),
//     fill: new Fill({
//     color: 'rgba(255,0,0,0.2)',
//     }),
// }),
// };

// const styleFunction = function (feature) {
//     return styles[feature.getGeometry().getType()];
// };

// const createVectorLayer = (params) => {
//     // const {geojsonLayer, nameLayer, layerEvents, priorityLayer, zIndexLayer} = params;
//     const {geojsonLayer, nameLayer, zIndexLayer} = params;
//     return {
//         layerType: 'VectorLayer',
//         options: {
//           sourceType: 'VectorSourceLayer',
//           // all the params for the source goes here
//           params: {
//             format: new GeoJSON(),
//             features: new GeoJSON().readFeatures(geojsonLayer,)
//           },
//           // the rest of the attributes are for the definition of the layer
//           zIndex: zIndexLayer,
//           name: nameLayer,
//           style: styleFunction
//         },
//         // extraProperties: {
//         //     events: layerEvents,
//         //     priority: priorityLayer
//         // }
//       }
    
// };

// const createClusterVectorLayer = (params) => {
//     // const {geojsonLayer, nameLayer, layerEvents, priorityLayer, zIndexLayer} = params;
//     const {geojsonLayer, nameLayer, zIndexLayer} = params;
//     const vectorsource = VectorSourceLayer({
//         params:{
//             format: new GeoJSON(),
//             features: new GeoJSON().readFeatures(geojsonLayer)
//         }
//     })
//     const styleCache = {};
//     return {
//         layerType: 'VectorLayer',
//         options: {
//           sourceType: 'ClusterSource',
//           // all the params for the source goes here
//           params: {
//             distance: 40,
//             minDistance: 20,
//             source: vectorsource
//           },
//           // the rest of the attributes are for the definition of the layer
//           zIndex: zIndexLayer,
//           name: nameLayer,
//           style: function (feature) {
//             const size = feature.get('features').length;
//             let style = styleCache[size];
//             if (!style) {
//               style = new Style({
//                 image: new CircleStyle({
//                   radius: 10,
//                   stroke: new Stroke({
//                     color: '#fff',
//                   }),
//                   fill: new Fill({
//                     color: '#2c3e50',
//                   }),
//                 }),
//                 text: new Text({
//                   text: size.toString(),
//                   fill: new Fill({
//                     color: '#fff',
//                   }),
//                 }),
//               });
//               styleCache[size] = style;
//             }
//             return style;
//           },
//         },
//         // extraProperties: {
//         //     events: layerEvents,
//         //     priority: priorityLayer
//         // }
//       }  

// }


const useLayerFactory = (layerType, options,mapAction) => {
    
    const layer = () => {
      let source = null;
      // Determine the source based on options.type and create it
      switch (options.sourceType) {
          case 'ArcGISRestTile':
              source = ArcGISRestTile(options.url, options.params);
              break;
          case 'OSMWMSTile':
              source = OSMWMSTile();
              break;
          case 'TileImageArcGISRest':
              source = TileImageArcGISRest(options.url, options.params);
              source.on('imageloaderror', function(event) {
                mapAction.delete_layer_by_name(options.name);
                alert('There is an error loading the nwm stream layer: https://mapservice.nohrsc.noaa.gov/arcgis/rest/services/national_water_model/NWM_Stream_Analysis/');
              });
              break;
          case 'WMSTile':
              source = WMSTile(options.url, options.params, options.source);
              break;
          case 'VectorSourceLayer':
              source = VectorSourceLayer(options);
              break;
          case 'ClusterSource':
              source = ClusterSource(options);
              break;
          default:
              console.error('Unsupported source type');
              return;
      }

      // Based on layerType, create the corresponding layer
      switch (layerType) {
          case 'OlImageTileLayer':
              return OlImageTileLayer({ ...options, source });
              break;
          case 'OlTileLayer':
              return OlTileLayer({ ...options, source });
              break;
          case 'VectorLayer':
              return VectorLayer({ ...options, source });
              break;
          default:
              console.error('Unsupported layer type');
              return null;
      }
    }
    return layer();
};


const getAllLayerNames = (map) => {
    return map.getLayers().getArray()
      .filter(layer => layer.get('name')) // Ensure the layer has a 'name' property
      .map(layer => layer.get('name')); // Extract the 'name' property
}


const getLayerToRemove = (map, layersArray) => {
    // Get all layers from the map
    const allLayers = map.getLayers().getArray();
    // Extract the names from layersArray for comparison
    const predefinedLayerNames = layersArray.map(layer => layer.options.name);

    // Filter out layers that are present in allLayers but not in predefinedLayerNames
    const layersToRemove = allLayers.filter(layer => {
        const layerName = layer.get('name'); // Assuming each layer has a 'name' property
        return !predefinedLayerNames.includes(layerName);
    });

    return layersToRemove;
}

const getLayerbyName = (map, layerName) => {
    const allLayers = map.getLayers().getArray();
    const onlyFirstLayer = allLayers.find(layer => layer.get('name') === layerName);
    return onlyFirstLayer
}
const zoomToLayerbyName = (map, layerName) => {
    const source = getLayerbyName(map, layerName).getSource();
    const layerExtent = source.getExtent();    
    map.getView().fit(layerExtent, {
        padding: [100,100,100,100],
        duration: 3000, // Optional animation duration in milliseconds.
    });
}   

const filterLayersNotInMap = (map, layersArray) => {
    const existingLayerNames = getAllLayerNames(map);

    return layersArray.filter(layer => {
        // Check if the layer's name is not in the existingLayerNames array
        return !existingLayerNames.includes(layer.options.name);
    });
}


const addLayer = (map, layerInfo,mapAction) => {
    const layer = useLayerFactory(layerInfo.layerType, layerInfo.options,mapAction);
    // let {events, priority} = layerInfo.extraProperties;
    // layer.set('events', events);
    // layer.set('priority', priority);
    map.addLayer(layer);

  };

const removeLayer = (map,layer) => {
    map.removeLayer(layer);
};  


// export {onClickHandler, filterLayersNotInMap,addLayer,removeLayer,getLayerToRemove,getClickEventLayers,zoomToLayerbyName, getLayerbyName,createVectorLayer,createClusterVectorLayer}
export {
    filterLayersNotInMap,
    addLayer,
    removeLayer,
    getLayerToRemove,
    zoomToLayerbyName,
    getLayerbyName,
    // createVectorLayer,
    // createClusterVectorLayer
}
