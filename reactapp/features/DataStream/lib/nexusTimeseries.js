// // nexusTimeseries.js
import { getConnection } from "./duckdbClient";

export async function getFlowTimeseriesForNexus(nexusId) {
  const conn = await getConnection();

  const q = await conn.query(`
    SELECT time, flow
    FROM vpu_data
    WHERE feature_id = ${nexusId}
    ORDER BY time
  `);

  // Convert the result to an array of objects
  const rows = q.toArray().map(Object.fromEntries);
  // Extract column names from the schema
  rows.columns = q.schema.fields.map((d) => {
    console.log(d.name);
    if (d.name === "time") {
      return "x";
    }
    else{
      return "y";
    }
  } );
  console.log(
    `[getFlowTimeseriesForNexus] (literal) nexusId=${nexusId} rows=${rows.length}`
  );
  return rows;

}
