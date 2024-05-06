import React, { useEffect , useRef } from 'react';
import MapContext from 'features/Map/contexts/MapContext';
import './map.css';
import { 
  filterLayersNotInMap,
  addLayer,
  removeLayer,
  getLayerToRemove
} from '../lib/utils';
import { useMap } from '../hooks/useMap';

import {LoadingText} from 'components/loader/LoadingComponents';

export const MapProvider = ({ children, layers= [] }) => {
  const {state,actions} = useMap();

  const mapRef = useRef();

  useEffect(() => {
    // added the map to the reference
    state.state.mapObject.setTarget(mapRef.current);
    // adding layers 
    layers.forEach(layer => {
      actions.addLayer(layer);
    });
    return  () => {
      if (state.state.mapObject) return;
      actions.reset_map();
    }

  }, []);

  useEffect(() => {
    if (!state.state.events.click) return;
    const onClickEventHandler = state.state.events.click
    state.state.mapObject.on('click',(evt)=>{
      onClickEventHandler(evt)
    })
  }, [state.state.events.click]);

  useEffect(() => {
    if (!state.state.events.loadstart) return;
    const onLoadStartEventHandler = state.state.events.loadstart
    state.state.mapObject.on('loadstart',(evt)=>{
      onLoadStartEventHandler(evt)
    })
  }, [state.state.events.loadstart]);

  useEffect(() => {
    if (!state.state.events.loadend) return;
    const onLoadEndEventHandler = state.state.events.loadend
    state.state.mapObject.on('loadend',(evt)=>{
      onLoadEndEventHandler(evt)
    })
  }, [state.state.events.loadend]);

  useEffect(() => {
    if (!state.state.events.pointermove) return;
    const onPointerMoveEventHandler = state.state.events.pointermove
    state.state.mapObject.on('pointermove',(evt)=>{
      onPointerMoveEventHandler(evt)
    })
  }, [state.state.events.pointermove]);


  useEffect(() => {
    if (state.state.layers.length === 0 ) return;
    //console.log("layers changed", state.state.layers);
    const layersToRemove = getLayerToRemove(state.state.mapObject, state.state.layers);
    const layersToAdd = filterLayersNotInMap(state.state.mapObject, state.state.layers);
    if (layersToRemove.length > 0){
      layersToRemove.forEach(layer => {
        removeLayer(state.state.mapObject,layer);
      });
    }
    else{
      layersToAdd.forEach(layerInfo => {
        // console.log(layerInfo)
        addLayer(state.state.mapObject,layerInfo,actions);

      });
    }


    return () => {
      if (state.state.mapObject) return
      // remove all layers if map was unmounted
      actions.delete_all_layers();
      state.state.mapObject.getAllLayers().forEach(layer => {
        state.state.mapObject.removeLayer(layer);
      })

    };
  // Ensures the hook re-runs only if the map or layer reference changes
  }, [state.state.layers]);

  // useEffect(() => {
  //   if (!state.state.extent) return;
  //   // console.log(state.state.extent)
  //   state.state.mapObject.getView().fit(state.state.extent, {duration: 1300, padding: [50, 50, 50, 50]});
  // }, [state.state.extent]);


  return (
    <MapContext.Provider value={{ ...state, actions }}>
        <div ref={mapRef} className="ol-map" >
          {children}
        </div>
        {
          state.state.toggle_loading_layers 
          ?
            <LoadingText id="progress">
              Loading ...
            </LoadingText>
          : <> </>
        }

    </MapContext.Provider>

  );
};