const baseMapLayerURL= 'https://server.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer';
const catchmentLayersURL = 'https://geoserver.hydroshare.org/geoserver/wms';
// 'https://geoserver.hydroshare.org/geoserver'
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
  // catchment layer
  {
      layerType: 'OlTileLayer',
      options: 
      {
          sourceType: 'WMSTile',
          url: catchmentLayersURL,
          // all the params for the source goes here
          params: {
              LAYERS: 'HS-f46a56af18d541b88c423a5dc2cdf898:catchments',
              Tiled: true,
          },
          // the rest of the attributes are for the definition of the layer
          name: "catchments",
          zIndex: 2

      },
          extraProperties: {
          events: [
            {
                'type': 'click', 
                'handler': (layer,event)=> {
                    console.log('wms layer')
                }
            }
          ],
          priority: 2
      }    
  }
]


export { initialLayersArray }
