import * as olExtent from 'ol/extent';


const getInfoFromLayers = async (event, clickable_layers, hydroFabricActions) => {
  console.log(clickable_layers)
  var checkForWMS = false;
  for (const layer of clickable_layers) {
    const layer_name = layer.get('name');
    if (layer_name === 'Nexus Layer') {
      checkForWMS = await displayFeatureInfo(event, layer, hydroFabricActions);
      console.log(checkForWMS)
    }
    if (checkForWMS && layer_name === 'Catchments Layer') {
        displayFeatureInfoWMS(event, layer, hydroFabricActions);
    }
  }
};



const displayFeatureInfo = (event,layer,hydroFabricActions) => {
  const pixel = event.map.getEventPixel(event.originalEvent);
  const map = event.map
  return layer.getFeatures(pixel).then(function (features) {
      const feature = features.length ? features[0] : undefined;
      if (feature) {
        var multipleFeatures = feature.get('features');
        // only one feature
        if (multipleFeatures.length < 2){
          // var nexus_id = feature.getProperties()['features'][0].get('toid').split('wb-')[1];
          // var nexus_id = multipleFeatures[0].get('toid').split('wb-')[1];
          var nexus_id = multipleFeatures[0].get('toid');
          hydroFabricActions.set_nexus_id(nexus_id);
        }
        //zoom it through all the features
        else{
          const extent = olExtent.boundingExtent(
            multipleFeatures.map((r) => r.getGeometry().getCoordinates())
            );
          map.getView().fit(extent, {duration: 1300, padding: [50, 50, 50, 50]});
        }
        return false
      }
      else{
        return true
      }  
    });
};

const displayFeatureInfoWMS = (event,layer,hydroFabricActions) => {
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
        .then((data) => {
          console.log(data)
          const data_catchment_id = data.features[0].properties.divide_id;
          console.log(data_catchment_id)
          hydroFabricActions.set_catchment_id(data_catchment_id);

        })     // Log the actual JSON data
        .catch(error => console.error('Error fetching data:', error)); 
    }

}


export { displayFeatureInfo,displayFeatureInfoWMS,getInfoFromLayers };