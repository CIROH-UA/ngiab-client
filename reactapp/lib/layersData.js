const baseMapLayerURL= 'https://server.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer';
const catchmentLayersURL = 'https://ahocevar.com/geoserver/wms';

const initialLayersArray = [
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


export { initialLayersArray }
