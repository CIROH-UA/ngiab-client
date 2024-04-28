const baseMapLayerURL= 'https://server.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer';
const catchmentLayersURL = 'http://localhost:8181/geoserver/wms';
// const catchmentLayersURL = 'https://geoserver.hydroshare.org/geoserver/wms';
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
            //   LAYERS: 'HS-f46a56af18d541b88c423a5dc2cdf898:catchments',
              LAYERS: 'topp:states',
              Tiled: true,
          },
          // the rest of the attributes are for the definition of the layer
          name: "catchments",
          zIndex: 2,
          source:{
            serverType: 'geoserver',
            crossOrigin: 'anonymous'
          }

      },
          extraProperties: {
          events: [
            {
                'type': 'click', 
                'handler': (layer,event)=> {
                    console.log('wms layer')
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
                        console.log(url)
                        fetch(url)
                        .then(response => response.json())  // Convert the response to JSON
                        .then(data => console.log(data))     // Log the actual JSON data
                        .catch(error => console.error('Error fetching data:', error)); 
                    }


                }
            }
          ],
          priority: 2
      }    
  }
]


export { initialLayersArray }
