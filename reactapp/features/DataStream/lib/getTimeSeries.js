// // nexusTimeseries.js
import { getConnection } from "./duckdbClient";

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