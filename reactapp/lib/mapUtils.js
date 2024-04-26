import { displayFeatureInfo } from "./mapEvents"


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
        priorityLayer: 1,
        zIndexLayer: 3
    }
}


export { makeNexusLayerParams }