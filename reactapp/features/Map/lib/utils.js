import { OlImageTileLayer, OlTileLayer, VectorLayer } from './layers/layers';
import { ArcGISRestTile, OSMWMSTile, TileImageArcGISRest, WMSTile, VectorSourceLayer,ClusterSource } from './source/sources';

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
    map.addLayer(layer);

  };

const removeLayer = (map,layer) => {
    map.removeLayer(layer);
};  

export {
    filterLayersNotInMap,
    addLayer,
    removeLayer,
    getLayerToRemove,
    zoomToLayerbyName,
    getLayerbyName,
}
