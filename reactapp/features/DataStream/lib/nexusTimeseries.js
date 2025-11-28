// nexusTimeseries.js
import { getConnection } from "./duckdbClient";

/**
 * Query flow timeseries for a maplibre nexus ID like "nex-1014271".
 * Returns [{ time: Date | string, flow: number }, ...]
 */
export async function getFlowTimeseriesForNexus(nexusId) {
  if (!nexusId) throw new Error("nexusId is required");

  // "nex-1014271" -> 1014271
  const featureId = parseInt(String(nexusId).replace(/^nex-/, ""), 10);
  if (Number.isNaN(featureId)) {
    throw new Error(`Invalid nexusId: ${nexusId}`);
  }

  const conn = await getConnection();
  console.log("Querying flow timeseries for feature_id:", featureId);
  
  // Prepared statement with positional parameter (DuckDB-Wasm AsyncPreparedStatement) 
  const stmt = await conn.prepare(`
    SELECT time, flow
    FROM vpu_data
    WHERE feature_id = ?
    ORDER BY time
  `);

  const table = await stmt.query(featureId);
  await stmt.close();

  // DuckDB-Wasm's query returns an Apache Arrow Table 
  const timeCol = table.getChild("time");
  const flowCol = table.getChild("flow");

  const series = [];
  for (let i = 0; i < table.length; i++) {
    series.push({
      time: timeCol.get(i),  // often already a Date; convert if needed
      flow: flowCol.get(i),
    });
  }

  return series;
}
