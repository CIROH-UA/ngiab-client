import { FEATURE_PROPERTIES } from "./data";
import proj4 from 'proj4';

function separateWords(word){
  return word.replace(/-/g, ' '); 
}

const capitalizeWords = (str) => str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

export const getYesterdayDateString = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

export const makeTitle = (forecast, feature_id) => {
  const cleanForecast = forecast.replace(/_/g, ' '); // replace all underscores
  const cleanId = separateWords(feature_id);
  return capitalizeWords(`${cleanId} ${cleanForecast} Forecast`);
};

export const formatLabel = (key) =>{
 return FEATURE_PROPERTIES[key] || key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}


export const layerIdToFeatureType = (layerId) => {
  switch(layerId) {
    case 'nexus-points':
      return 'id';
    case 'divides':
      return 'divide_id';
    default:
      return null;
  }
};

// EPSG:5070 (NAD83 / Conus Albers – units in meters)
proj4.defs(
  'EPSG:5070',
  '+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 ' +
  '+x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs'
);

// WGS84 lon/lat
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

// Convenience wrapper: [x5070, y5070] → { lon, lat }
export function toWgs84From5070(x, y) {
  const [lon, lat] = proj4('EPSG:5070', 'EPSG:4326', [x, y]);
  return { lon, lat };
}