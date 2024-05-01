import { getClickEventLayers,getInfoFromLayers } from './mapUtils';


const onClickLayersEvent = async (event,hydroFabricActions,setIsLoading) => {
  event.preventDefault();
  // console.log('click event', event);
  let layers = getClickEventLayers(event, event.map);
  getInfoFromLayers(event, layers, hydroFabricActions,setIsLoading)

}

const onPointerMoveLayersEvent = async (e,layer) => {
  if (e.dragging) {
    return;
  }
  var map = e.map;
  var pixel = map.getEventPixel(e.originalEvent);
  var hit = map.hasFeatureAtPixel(pixel);
  // map.getViewport().style.cursor = hit ? 'pointer' : '';

  getClickEventLayers(e, map).forEach(layer => {

    if (layer.get('name') === 'Catchments Layer') {
      const data = layer.getData(pixel);
      hit = data && data[3] > 0; // transparent pixels have zero for data[3]
      map.getTargetElement().style.cursor = hit ? 'pointer' : '';
    }
    else{
      map.getViewport().style.cursor = hit ? 'pointer' : '';
    }

  })
}

const onStartLoadingLayersEvent = async (evt, setIsLoading) =>{
  setIsLoading(true);
}
const onEndLoadingLayerEvent = async (evt, setIsLoading) =>{
  // var map = evt.map;
  // map.getLayers().getArray().forEach(layer => {
  // if (layer.get('name') === 'Nexus Layer'){
  //   const extent = layer.getSource().getExtent();
  //   map.getView().fit(extent, {duration: 1300, padding: [50, 50, 50, 50]});
  // }

  // })
  setIsLoading(false);
}


export { onClickLayersEvent,onStartLoadingLayersEvent,onEndLoadingLayerEvent,onPointerMoveLayersEvent };