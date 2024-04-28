import * as olExtent from 'ol/extent';

const displayFeatureInfo = function (event,layer,hydroFabricActions) {
  console.log("hhhhh")
  const pixel = event.map.getEventPixel(event.originalEvent);
  const map = event.map
    layer.getFeatures(pixel).then(function (features) {
      const feature = features.length ? features[0] : undefined;
      if (feature) {
        var multipleFeatures = feature.get('features');
        // only one feature
        if (multipleFeatures.length < 2){
          // var nexus_id = feature.getProperties()['features'][0].get('toid').split('wb-')[1];
          var nexus_id = multipleFeatures[0].get('toid').split('wb-')[1];
          hydroFabricActions.set_nexus_id(nexus_id);
        }
        else{
          const extent = olExtent.boundingExtent(
            multipleFeatures.map((r) => r.getGeometry().getCoordinates())
            );
          map.getView().fit(extent, {duration: 1300, padding: [50, 50, 50, 50]});
        }
      }

  
    });
};

export { displayFeatureInfo };