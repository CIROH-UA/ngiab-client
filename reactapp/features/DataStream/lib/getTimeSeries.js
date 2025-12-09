// // nexusTimeseries.js
import { getConnection } from "./duckdbClient";
import { getNCFiles, makeGpkgUrl } from './s3Utils';
import { getCacheKey } from './opfsCache';
import { loadVpuData, getVariables } from './vpuDataLoader';
import { makeTitle } from './utils';

export async function getTimeseries(id, cacheKey, variable) {
  const conn = await getConnection();
  
  const q = await conn.query(`
    SELECT time, ${variable}
    FROM ${cacheKey}
    WHERE feature_id = ${id}
    ORDER BY time
  `);

  // Convert the result to an array of objects
  const rows = q.toArray().map(Object.fromEntries);
  // Extract column names from the schema
  rows.columns = q.schema.fields.map((d) => d.name);
  console.log(
    `[getTimeseries] (literal) id=${id} rows=${rows.length}`
  );
  return rows;
}

export const getVariableUnits = (variableName) => {
  if (!variableName) return '';

  const variableUnits = {
    rain_rate: 'mm/h',
    giuh_runoff: 'mm',
    infiltration_excess: '',
    direct_runoff: '',
    nash_lateral_runoff: '',
    deep_gw_to_channel_flux: '',
    soil_to_gw_flux: '',
    q_out: '',
    potential_et: '',
    actual_et: '',
    gw_storage: 'm/m',
    soil_storage: 'm/m',
    soil_storage_change: '',
    surf_runoff_scheme: '',
    nwm_ponded_depth: '',
    type: '',
    flow: 'm³/s',
    velocity: 'm/s',
    depth: 'm',
    nudge: 'm³/s',
    streamflow: 'm³/s',
  };
  const variable = variableName.toLowerCase();
  return variableUnits[variable] ?? '';
};

export async function loadTimeSeriesForFeature({
  feature_id,        // e.g. "nex-2615322" or "div-12345"
  vpu,               // e.g. "VPU_06"
  date,
  forecast,
  cycle,
  time,
  // current variable (optional). If not present / not in list, we use first var.
  variable,

  // store setters
  set_table,
  set_variables,
  set_variable,
  set_series,
  set_layout,
}) {
  // 1) Build core paths / cache key
  const nc_files_parsed = await getNCFiles(date, forecast, cycle, time, vpu);
  const vpu_gpkg = makeGpkgUrl(vpu);
  const cacheKey = getCacheKey(date, forecast, cycle, time, vpu);

  // 2) Load VPU data (cached by cacheKey)
  await loadVpuData({
    cacheKey,
    nc_files: nc_files_parsed,
    vpu_gpkg,
  });

  set_table(cacheKey);

  // 3) Get available variables and pick one
  const vars = await getVariables({ cacheKey });
  set_variables(vars);

  const chosenVar =
    variable && vars.includes(variable) ? variable : vars[0];

  set_variable(chosenVar);

  // 4) Load time series for this feature + variable
  const id = feature_id.split('-')[1]; // numeric part used in parquet
  const series = await getTimeseries(id, cacheKey, chosenVar);

  const xy = series.map((d) => ({
    x: new Date(d.time),
    y: d[chosenVar],
  }));
  set_series(xy);

  // 5) Update layout (title, y-axis label, etc.)
  set_layout({
    yaxis: chosenVar,
    xaxis: 'Time',
    title: makeTitle(forecast, feature_id),
  });

  // Return things in case caller needs them
  return { cacheKey, variables: vars, variable: chosenVar, series: xy };
}

export async function loadTimeSeriesForVariable({
  feature_id,        // e.g. "nex-2615322" or "div-12345"
  forecast,
  chosenVar,        // variable to load

  cacheKey,        // existing cache key

  // store setters
  set_variable,
  set_series,
  set_layout,
}) {

  set_variable(chosenVar);

  // 4) Load time series for this feature + variable
  const id = feature_id.split('-')[1]; // numeric part used in parquet
  const series = await getTimeseries(id, cacheKey, chosenVar);

  const xy = series.map((d) => ({
    x: new Date(d.time),
    y: d[chosenVar],
  }));
  set_series(xy);

  // 5) Update layout (title, y-axis label, etc.)
  set_layout({
    yaxis: chosenVar,
    xaxis: 'Time',
    title: makeTitle(forecast, feature_id),
  });
   
  
}

  // store setters