function separateWords(word){
  return word.replace(/-/g, ' '); 
}

const capitalizeWords = (str) => str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');


export const makeTitle = (forecast, feature_id) => {
  const cleanForecast = forecast.replace(/_/g, ' '); // replace all underscores
  const cleanId = separateWords(feature_id);
  return capitalizeWords(`${cleanId} ${cleanForecast} Forecast`);
};

export const formatLabel = (key) =>{
 return matchDivideFeatures[key] || key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const matchDivideFeatures = {
  'tot_drainage_areasqkm': 'Total Drainage Area (km2)',
  'areasqkm': 'Area (km2)',
  'toid': 'To ID',
  'vpuid': 'VPU ID',
  'lengthkm': 'Length (km)',
  'has_flowline': 'Has Flowline',
  'divide_id': 'Divide ID',
};
