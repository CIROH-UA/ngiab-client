import { OlImageTileLayer, OlTileLayer, VectorLayer } from './layers/layers';
import { ArcGISRestTile, OSMWMSTile, TileImageArcGISRest, WMSTile, VectorSourceLayer } from './source/sources';
import GeoJSON from 'ol/format/GeoJSON';


const createVectorLayer = (params) => {
    const {geojsonLayer, nameLayer, styleLayer, layerEvents, priorityLayer, zIndexLayer} = params;
    return {
        layerType: 'VectorLayer',
        options: {
          sourceType: 'VectorSourceLayer',
          // all the params for the source goes here
          params: {
            // format: new GeoJSON(options='EPSG:3857'),
            // format: new GeoJSON(),
            features: new GeoJSON().readFeatures(geojsonLayer,{
                dataProjection: 'EPSG:3857',
                // featureProjection: 'EPSG:3857'
            
            })
          },
          // the rest of the attributes are for the definition of the layer
          zIndex: zIndexLayer,
          name: nameLayer,
          style: styleLayer      
        },
        extraProperties: {
            events: layerEvents,
            priority: priorityLayer
        }
      }
    
};


//get the clickable layers: this works for image layers
// more info here https://gist.github.com/xemoka/cb4cf95018fdc2cebac4da8f0c308723
// an issue in this: https://github.com/openlayers/openlayers/issues/9721
const getClickEventLayers = (event, mapObject) => {
    let layers = []
    mapObject.forEachLayerAtPixel(
        event.pixel,
        layer => {
            layers.push(layer)
        },
        {
            layerFilter: layer => {
                return (
                    // for the following events: [{'type': 'click', 'handler': onClickHandler}] please filter to only get elements that have type click please
                   
                    layer.get('events') && layer.get('events').length > 0 && layer.get('events').findIndex(event => event.type === 'click') > -1
                )
            },
            hitTolerance: 0
        }
    )

    return layers
}

const findKeyWithMaxValue = (obj) => {
    let maxValue = -Infinity; // Initialize with a very low value
    let maxKey = null;
  
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (obj[key] > maxValue) {
          maxValue = obj[key];
          maxKey = key;
        }
      }
    }
  
    return maxKey;
}

// according to the weight of the layer, we will find the priority layer
// the priority layer is the one with the highest weight, and it is given by the priority attribute
// the priority attribute is set in the layer object

const findPriorityLayerForOnClickEvent = (layers) => {
    let layerWeight={}
    let priorityLayer = layers[0]

    layers.forEach(function(layer,index){
        layerWeight[index] = layer.get('priority');
    });

    let priorityLayerIndex = findKeyWithMaxValue(layerWeight);
    priorityLayer = layers[priorityLayerIndex]
    return priorityLayer
}


// onClickHandler will call the click event handler for the layer with the highest priority
// the click event handler is set in the layer object
const onClickHandler = async (event) => {
    event.preventDefault();
    const clickedCoordinate = event.map.getCoordinateFromPixel(event.pixel);
    let layers = getClickEventLayers(event,event.map)
    if (layers.length > 0) {
        // let layer = layers[0]
        let layer = findPriorityLayerForOnClickEvent(layers)
        let clickHandler = layer.get('events').find(event => event.type === 'click').handler
        clickHandler(layer, event)
    }
}

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
              source = WMSTile(options.url, options.params);
              break;
          case 'VectorSourceLayer':
              source = VectorSourceLayer(options);
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
    let {events, priority} = layerInfo.extraProperties;
    layer.set('events', events);
    layer.set('priority', priority);
    map.addLayer(layer);
    console.log(layer)

  };

const removeLayer = (map,layer) => {
    map.removeLayer(layer);
};  


export {onClickHandler, filterLayersNotInMap,addLayer,removeLayer,getLayerToRemove,getClickEventLayers,zoomToLayerbyName, getLayerbyName,createVectorLayer}