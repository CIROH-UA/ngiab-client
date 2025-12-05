export const makeTitle = (forecast, feature_id) => {
  const cleanForecast = forecast.replace(/_/g, ' '); // replace all underscores
  return `${feature_id} ${cleanForecast} Forecast`;
};
