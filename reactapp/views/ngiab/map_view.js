import React, { Fragment, useEffect,useCallback,useState } from 'react';
import appAPI from 'services/api/app';
import { useMapContext } from 'features/Map/hooks/useMapContext';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
// import {createVectorLayer, createClusterVectorLayer} from 'features/Map/lib/mapUtils';
import {
  onClickLayersEvent,
  onStartLoadingLayersEvent, 
  onEndLoadingLayerEvent 
} from 'lib/mapEvents'
import { initialLayersArray } from 'lib/layersData';
import { 
  makeNexusLayerParams, 
  makeCatchmentLayer,
  createClusterVectorLayer
} from 'lib/mapUtils';
import LoadingAnimation from 'components/loader/LoadingAnimation';

const MapView = (props) => {
  const {actions: mapActions } = useMapContext();

  const {state: hydroFabricState, actions: hydroFabricActions } = useHydroFabricContext(); 
  
  const nexusLayerParamsCallBack = useCallback(() => {
    return makeNexusLayerParams();
  })

  const catchmentLayerCallBack = useCallback(() => {
    const catchmentLayersURL = 'http://localhost:8181/geoserver/wms'; 
    return makeCatchmentLayer(catchmentLayersURL);
  })

  const onClickEventHandlerCallBack = useCallback((event) => {
    return onClickLayersEvent(event,hydroFabricActions,props.setIsLoading);
  })

  const onLoadStartHandlerCallBack = useCallback((event) => {
    return onStartLoadingLayersEvent(event,props.setIsLoading);
  })
  const onLoadEndHandlerCallBack = useCallback((event) => {
    return onEndLoadingLayerEvent(event,props.setIsLoading);
  })

  useEffect(() => {

    //Add events
    mapActions.add_click_event(onClickEventHandlerCallBack);
    mapActions.add_load_start_event(onLoadStartHandlerCallBack);
    mapActions.add_load_end_event(onLoadEndHandlerCallBack);

    //Add Layers
    appAPI.getNexusGeoJson().then(response => {
        console.log(response)
        // Define the parameters for the layer
        var nexusLayerParams = nexusLayerParamsCallBack();
        var catchmentLayer = catchmentLayerCallBack();

        nexusLayerParams['geojsonLayer']=response.geojson;
        
        const nexusClusterLayer = createClusterVectorLayer(nexusLayerParams);

        mapActions.addLayer(nexusClusterLayer);
        mapActions.addLayer(catchmentLayer);
        hydroFabricActions.set_nexus_list(response.list_ids);


    }).catch(error => {
        console.log(error)
    })

    //adding layers
    initialLayersArray.forEach(layer => {
      mapActions.addLayer(layer);
    })
    // remove the layers wheen the component unmounts
    return () => {

      //delete added layers when unmounting
      initialLayersArray.forEach(layer => {
        mapActions.delete_layer_by_name(layer.options.name)
      })
      mapActions.delete_layer_by_name('Nexus Layer')
    }

  }, []);


  
  return (
    <Fragment>
      {props.isLoading ?
        <LoadingAnimation /> : 
        <></>
      }
      
    </Fragment>
  );
};

export default MapView;
