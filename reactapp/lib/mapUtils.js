import { displayFeatureInfo, displayFeatureInfoWMS  } from "./mapEvents"


let makeNexusLayerParams = (hydroFabricActions) => {
    return {
        geojsonLayer: {}, // This should be your GeoJSON data
        nameLayer: 'Nexus Layer',
        layerEvents: [
            {
                'type': 'click', 
                'handler': (layer,event)=> {
                    console.log('cliking on layer')
                    displayFeatureInfo(event,layer,hydroFabricActions)
                }
            }
        ], // This should be an object with any events you want to attach to the layer
        priorityLayer: 2,
        zIndexLayer: 3
    }
}


let makeCatchmentLayer = (catchmentLayersURL,hydroFabricActions) =>{
    return   {
        layerType: 'OlTileLayer',
        options: 
        {
            sourceType: 'WMSTile',
            url: catchmentLayersURL,
            // all the params for the source goes here
            params: {
              //   LAYERS: 'HS-f46a56af18d541b88c423a5dc2cdf898:catchments',
                LAYERS: 'nextgen:catchments',
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
                      displayFeatureInfoWMS(event,layer, hydroFabricActions)
  
                  }
              }
            ],
            priority: 2
        }    
    }
}

export { makeNexusLayerParams, makeCatchmentLayer }