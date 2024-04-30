import React, { useEffect , useRef } from 'react';
import MapContext from 'features/Map/contexts/MapContext';
// import { MapContainer } from './styles/Map.styled';
import './map.css';
import { onClickHandler,filterLayersNotInMap,addLayer,removeLayer,getLayerToRemove} from '../lib/mapUtils';
import { useMap } from '../hooks/useMap';

import {LoadingText} from 'components/loader/LoadingComponents';

export const MapProvider = ({ children,layers= [], onClickEventHandler }) => {
  const {state,actions} = useMap();

  const mapRef = useRef();

  useEffect(() => {
    // added the map to the reference
    state.state.mapObject.setTarget(mapRef.current);
    // Define the click handler of the layer
    if (onClickEventHandler) {
      actions.add_click_event(onClickEventHandler);
    }

    // Define the loading handler of the map object
    state.state.mapObject.on('loadstart', function () {
      actions.toggle_loading_layers();
    });
    state.state.mapObject.on('loadend', function () {
      actions.toggle_loading_layers();
    });
    // add the event for cursor in map
    // adding layers 
    layers.forEach(layer => {
      ////console.log("adding layer to store", layer);
      actions.addLayer(layer);
    });
    return  () => {
      if (state.state.mapObject) return;
      // console.log("unmounting map");
      actions.reset_map();
    }

  }, []);

  useEffect(() => {
    if (!state.state.events.click) return;
    console.log("click event added");
    const onClickEventHandler = state.state.events.click
    state.state.mapObject.on('click',(evt)=>{
      onClickHandler(evt,onClickEventHandler)
    })
  }, [state.state.events.click]);

  useEffect(() => {
    if (state.state.layers.length === 0 ) return;
    //console.log("layers changed", state.state.layers);
    const layersToRemove = getLayerToRemove(state.state.mapObject, state.state.layers);
    const layersToAdd = filterLayersNotInMap(state.state.mapObject, state.state.layers);
    if (layersToRemove.length > 0){
      layersToRemove.forEach(layer => {
        console.log("removing layer", layer);
        removeLayer(state.state.mapObject,layer);
      });
    }
    else{
      layersToAdd.forEach(layerInfo => {
        // console.log(layerInfo)
        console.log("adding layer", layerInfo);
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


  return (
  // <MapContainer>
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
  // </MapContainer>

  );
};