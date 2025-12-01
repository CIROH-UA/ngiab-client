// // nexusTimeseries.js
import { getConnection } from "./duckdbClient";

export async function getFlowTimeseriesForNexus(nexusId, cacheKey) {
  const conn = await getConnection();
  
  const q = await conn.query(`
    SELECT time, flow
    FROM ${cacheKey}
    WHERE feature_id = ${nexusId}
    ORDER BY time
  `);

  // Convert the result to an array of objects
  const rows = q.toArray().map(Object.fromEntries);
  // Extract column names from the schema
  rows.columns = q.schema.fields.map((d) => d.name);
  console.log(
    `[getFlowTimeseriesForNexus] (literal) nexusId=${nexusId} rows=${rows.length}`
  );
  return rows;
}
