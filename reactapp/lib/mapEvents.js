import { getClickEventLayers,getInfoFromLayers } from './mapUtils';


const onClickLayersEvent = async (event,hydroFabricActions,setIsLoading) => {
  event.preventDefault();
  console.log('click event', event);
  let layers = getClickEventLayers(event, event.map);
  getInfoFromLayers(event, layers, hydroFabricActions,setIsLoading)

}


const onStartLoadingLayersEvent = async (evt, setIsLoading) =>{
  setIsLoading(true);
}
const onEndLoadingLayerEvent = async (evt, setIsLoading) =>{
  setIsLoading(false);
}


export { onClickLayersEvent,onStartLoadingLayersEvent,onEndLoadingLayerEvent };