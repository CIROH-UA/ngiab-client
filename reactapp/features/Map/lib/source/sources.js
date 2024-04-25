
import TileArcGISRest from "ol/source/TileArcGISRest";
import OSM from 'ol/source/OSM';
import ImageArcGISRest from "ol/source/ImageArcGISRest";
import TileWMS from "ol/source/TileWMS";
import VectorSource from 'ol/source/Vector.js';

const ArcGISRestTile = (url, params) => {
  return new TileArcGISRest({
    url,
    params
  });
};


const OSMWMSTile = () => {
  return new OSM();
};


const TileImageArcGISRest = (url, params) => {
  return new ImageArcGISRest({
    url,
    params
  });
};

const WMSTile = (url, params) => {
  return new TileWMS({
    url,
    params,
  });
};


const VectorSourceLayer = (options) => {
  // Destructure format and features from options.params
  return new VectorSource({
    ...options.params
  });
};

export { ArcGISRestTile, OSMWMSTile, TileImageArcGISRest, WMSTile, VectorSourceLayer }