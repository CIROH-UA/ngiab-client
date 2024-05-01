import * as olExtent from 'ol/extent';
import GeoJSON from 'ol/format/GeoJSON';
import {
    Circle as CircleStyle,
    Fill,
    Stroke,
    Style,
    Text,
  } from 'ol/style';
import { VectorSourceLayer } from 'features/Map/lib/source/sources';
import { sldCatchmentStyle } from './layersData';

const image = new CircleStyle({
    radius: 5,
    fill: null,
    stroke: new Stroke({color: 'red', width: 1}),
  });
  
const styles = {
  'Point': new Style({
      image: image,
  }),
  'LineString': new Style({
      stroke: new Stroke({
      color: 'green',
      width: 1,
      }),
  }),
  'MultiLineString': new Style({
      stroke: new Stroke({
      color: 'green',
      width: 1,
      }),
  }),
  'MultiPoint': new Style({
      image: image,
  }),
  'MultiPolygon': new Style({
      stroke: new Stroke({
      color: 'yellow',
      width: 1,
      }),
      fill: new Fill({
      color: 'rgba(255, 255, 0, 0.1)',
      }),
  }),
  'Polygon': new Style({
      stroke: new Stroke({
      color: 'blue',
      lineDash: [4],
      width: 3,
      }),
      fill: new Fill({
      color: 'rgba(0, 0, 255, 0.1)',
      }),
  }),
  'GeometryCollection': new Style({
      stroke: new Stroke({
      color: 'magenta',
      width: 2,
      }),
      fill: new Fill({
      color: 'magenta',
      }),
      image: new CircleStyle({
      radius: 10,
      fill: null,
      stroke: new Stroke({
          color: 'magenta',
      }),
      }),
  }),
  'Circle': new Style({
      stroke: new Stroke({
      color: 'red',
      width: 2,
      }),
      fill: new Fill({
      color: 'rgba(255,0,0,0.2)',
      }),
  }),
};

const styleFunction = function (feature) {
    return styles[feature.getGeometry().getType()];
};

const createVectorLayer = (params) => {
    // const {geojsonLayer, nameLayer, layerEvents, priorityLayer, zIndexLayer} = params;
    const {geojsonLayer, nameLayer, zIndexLayer} = params;
    return {
        layerType: 'VectorLayer',
        options: {
          sourceType: 'VectorSourceLayer',
          // all the params for the source goes here
          params: {
            format: new GeoJSON(),
            features: new GeoJSON().readFeatures(geojsonLayer,)
          },
          // the rest of the attributes are for the definition of the layer
          zIndex: zIndexLayer,
          name: nameLayer,
          style: styleFunction
        },
      }
    
};

const createClusterVectorLayer = (params) => {
    // const {geojsonLayer, nameLayer, layerEvents, priorityLayer, zIndexLayer} = params;
    const {geojsonLayer, nameLayer, zIndexLayer} = params;
    const vectorsource = VectorSourceLayer({
        params:{
            format: new GeoJSON(),
            features: new GeoJSON().readFeatures(geojsonLayer)
        }
    })
    const styleCache = {};
    return {
        layerType: 'VectorLayer',
        options: {
          sourceType: 'ClusterSource',
          // all the params for the source goes here
          params: {
            distance: 40,
            minDistance: 20,
            source: vectorsource
          },
          // the rest of the attributes are for the definition of the layer
          zIndex: zIndexLayer,
          name: nameLayer,
          style: function (feature) {
            const size = feature.get('features').length;
            let style = styleCache[size];
            if (!style) {
              style = new Style({
                image: new CircleStyle({
                  radius: 10,
                  stroke: new Stroke({
                    color: '#DA4167',
                    width: 2
                  }),
                  fill: new Fill({
                    // color: '#ffffff00',
                    color: '#000000',

                  }),
                }),
                text: new Text({
                  text: size.toString(),
                  fill: new Fill({
                    color: '#FFFFFF',
                  }),
                }),
              });
              styleCache[size] = style;
            }
            return style;
          },
        },

      }  

}




let makeNexusLayerParams = () => {
    return {
        geojsonLayer: {}, // This should be your GeoJSON data
        nameLayer: 'Nexus Layer',
        priorityLayer: 2,
        zIndexLayer: 3
    }
}


let makeCatchmentLayer = (catchmentLayersURL) =>{
    return   {
        layerType: 'OlTileLayer',
        options: 
        {
            sourceType: 'WMSTile',
            url: catchmentLayersURL,
            // all the params for the source goes here
            params: {
                LAYERS: 'nextgen:catchments',
                Tiled: true,
                SLD_BODY: sldCatchmentStyle
            },
            // the rest of the attributes are for the definition of the layer
            name: "Catchments Layer",
            zIndex: 2,
            source:{
              serverType: 'geoserver',
              crossOrigin: 'anonymous'
            }
  
        },

    }
}

const customForEachLayerAtPixelLayerFilter = (layer) =>{
  return layer.get('name') !== 'baseMapLayer'
  // return  layer.get('events') && layer.get('events').length > 0 && layer.get('events').findIndex(event => event.type === 'click') > -1
}


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
          layerFilter: customForEachLayerAtPixelLayerFilter,

          hitTolerance: 0
      }
  )

  return layers
}


const getInfoFromLayers = async (event, clickable_layers, hydroFabricActions,setIsLoading) => {
  var checkForWMS = false;
  for (const layer of clickable_layers) {
    const layer_name = layer.get('name');
    if (layer_name === 'Nexus Layer') {
      checkForWMS = await displayFeatureInfo(event, layer, hydroFabricActions);
    }
    if (checkForWMS && layer_name === 'Catchments Layer') {
        displayFeatureInfoWMS(event, layer, hydroFabricActions,setIsLoading);
    }
  }
};


const displayFeatureInfo = (event,layer,hydroFabricActions) => {
    const pixel = event.map.getEventPixel(event.originalEvent);
    const map = event.map
    return layer.getFeatures(pixel).then(function (features) {
        const feature = features.length ? features[0] : undefined;
        if (feature) {
          var multipleFeatures = feature.get('features');
          // only one feature
          if (multipleFeatures.length < 2){
            var nexus_id = multipleFeatures[0].get('id');
            hydroFabricActions.set_nexus_id(nexus_id);
          }
          //zoom it through all the features
          else{
            const extent = olExtent.boundingExtent(
              multipleFeatures.map((r) => r.getGeometry().getCoordinates())
              );
            map.getView().fit(extent, {duration: 1300, padding: [50, 50, 50, 50]});
          }
          return false
        }
        else{
          return true
        }  
      });
  };
  
 const getMapExtentForNexusLayer = (layer) => {
  // layers.forEach(layer => {
    if (layer.get('name') === 'Nexus Layer'){
      const extent = layer.getSource().getExtent();
      return extent
    }
  
  // })

 }

  const displayFeatureInfoWMS = (event,layer,hydroFabricActions,setIsLoading) => {
      setIsLoading(true)
      const wmsSource = layer.getSource();
      const map = event.map
  
      const viewResolution =  map.getView().getResolution();
      const url = wmsSource.getFeatureInfoUrl(
        event.coordinate,
        viewResolution,
        'EPSG:3857',
        {'INFO_FORMAT': 'application/json'},
      );
      if (url) {
          fetch(url)
          .then(response => response.json())  // Convert the response to JSON
          .then((data) => {
            // console.log(data)
            const data_catchment_id = data.features[0].properties.divide_id;
            // console.log(data_catchment_id)
            hydroFabricActions.set_catchment_id(data_catchment_id);
            // setIsLoading(false)
  
          })     // Log the actual JSON data
          .catch(error => {
            setIsLoading(false)
            console.error('Error fetching data:', error)
        }); 
      }
      else{
        setIsLoading(false)
  
      }
  
  }
export { 
  makeNexusLayerParams, 
  makeCatchmentLayer,
  displayFeatureInfo, 
  displayFeatureInfoWMS, 
  customForEachLayerAtPixelLayerFilter,
  getClickEventLayers,
  getInfoFromLayers,
  createClusterVectorLayer,
  createVectorLayer,
  getMapExtentForNexusLayer
}