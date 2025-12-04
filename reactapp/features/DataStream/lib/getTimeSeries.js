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

const availableVariables = (vs) => {
  const variables = [];
  for (let i = 0; i < vs.length; i++) {
    variables.push({ value: vs[i], label: vs[i] });
  }
  return variables;
}