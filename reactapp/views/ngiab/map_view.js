import React, { Fragment, useEffect } from 'react';
import appAPI from 'services/api/app';
import { useMapContext } from 'features/Map/hooks/useMapContext';
// import {Stroke, Style} from 'ol/style.js';
import {createVectorLayer, createClusterVectorLayer} from 'features/Map/lib/mapUtils';

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



  



let nexusLayerParams = {
    geojsonLayer: {}, // This should be your GeoJSON data
    nameLayer: 'Nexus Layer',
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
        const nexusLayer = createVectorLayer(nexusLayerParams);
        const nexusClusterLayer = createClusterVectorLayer(nexusLayerParams);
        // console.log(nexusLayer)
        // mapActions.addLayer(nexusLayer);
        // console.log(nexusClusterLayer);
        mapActions.addLayer(nexusClusterLayer);

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
