import React, { Fragment, useEffect,useCallback,useState } from 'react';
import appAPI from 'services/api/app';
import { useMapContext } from 'features/Map/hooks/useMapContext';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
// import {createVectorLayer, createClusterVectorLayer} from 'features/Map/lib/mapUtils';
import {
  onClickLayersEvent,
  onStartLoadingLayersEvent, 
  onEndLoadingLayerEvent,
  onPointerMoveLayersEvent 
} from 'lib/mapEvents'
import { initialLayersArray } from 'lib/layersData';
import { 
  makeNexusLayerParams, 
  makeCatchmentLayer,
  createClusterVectorLayer,
  getMapExtentForNexusLayer
} from 'lib/mapUtils';
import LoadingAnimation from 'components/loader/LoadingAnimation';

const MapView = (props) => {
  const {state: mapState, actions: mapActions } = useMapContext();

  const {actions: hydroFabricActions } = useHydroFabricContext(); 
  
  const nexusLayerParamsCallBack = useCallback(() => {
    return makeNexusLayerParams();
  })

  const catchmentLayerCallBack = useCallback(() => {
    const catchmentLayersURL = 'http://localhost:8181/geoserver/wms'; 
    return makeCatchmentLayer(catchmentLayersURL);
  },[])
  const onPointerMoveLayersEventCallback = useCallback((event) => {
    return onPointerMoveLayersEvent(event)
  },[]);
  const onClickEventHandlerCallBack = useCallback((event) => {
    return onClickLayersEvent(event,hydroFabricActions,props.setIsLoading);
  },[])

  const onLoadStartHandlerCallBack = useCallback((event) => {
    return onStartLoadingLayersEvent(event,props.setIsLoading);
  },[])

  const onLoadEndHandlerCallBack = useCallback((event) => {
    return onEndLoadingLayerEvent(event,props.setIsLoading);
  },[])

  // const getMapExtentForNexusLayerCallBack = useCallback(() => {
  //   console.log(mapState.mapObject.getLayers().getArray())
  //   const vector_layer = mapState.mapObject.getLayers().getArray().find(layer => layer.get('name') === 'Nexus Layer');
  //   if (!vector_layer) return
  //   console.log(vector_layer)
  //   return getMapExtentForNexusLayer(vector_layer);
  // },[mapState.mapObject])

  useEffect(() => {

    //Add events
    mapActions.add_click_event(onClickEventHandlerCallBack);
    mapActions.add_load_start_event(onLoadStartHandlerCallBack);
    mapActions.add_load_end_event(onLoadEndHandlerCallBack);
    mapActions.add_pointer_move_event(onPointerMoveLayersEventCallback);


    //Add Layers
    appAPI.getNexusGeoJson().then(response => {

        // Define the parameters for the layer
        var nexusLayerParams = nexusLayerParamsCallBack();
        var catchmentLayer = catchmentLayerCallBack();

        nexusLayerParams['geojsonLayer']=response.geojson;
        
        const nexusClusterLayer = createClusterVectorLayer(nexusLayerParams);

        mapActions.addLayer(nexusClusterLayer);
        mapActions.addLayer(catchmentLayer);

    }).catch(error => {
        console.log(error)
    })

    //adding layers
    initialLayersArray.forEach(layer => {
      mapActions.addLayer(layer);
    })
    ;
    
    // remove the layers wheen the component unmounts
    return () => {
      if(!mapState.mapObject) return
      //delete added layers when unmounting
      initialLayersArray.forEach(layer => {
        mapActions.delete_layer_by_name(layer.options.name)
      })
      mapActions.delete_layer_by_name('Nexus Layer')
      mapActions.delete_layer_by_name('Catchments Layer')
      
    }

  }, []);

  // useEffect(() => {
  //   // const clusterLayerExtent = getMapExtentForNexusLayerCallBack();
  //   // console.log(clusterLayerExtent)
  //   if (mapState.mapObject.getLayers().getArray().length < 1) return
  //   const vector_layer = mapState.mapObject.getLayers().getArray().find(layer => layer.get('name') === 'Nexus Layer');
  //   console.log(vector_layer)
  //   if (!vector_layer) return
  //   const clusterLayerExtent = getMapExtentForNexusLayer(vector_layer);
  //   mapActions.set_extent(clusterLayerExtent);

  // }, [mapState.mapObject])
  
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
