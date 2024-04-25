import {Image as ImageLayer } from 'ol/layer.js';
import TileLayer from "ol/layer/Tile";
import OLVectorLayer from "ol/layer/Vector";

const OlImageTileLayer = ({source, name,zIndex=0})=>{
  return new ImageLayer({
    source,
    name,
    zIndex
  });
}

const OlTileLayer = ({ source, name, zIndex=0 }) => {
    return new TileLayer({
        source,
        name,
        zIndex
    });
};

const VectorLayer = ({ name,source, style, zIndex=0 }) => {
    return new OLVectorLayer({
        name,
        source,
        style,
        zIndex
      });
}


export { OlImageTileLayer, OlTileLayer, VectorLayer }