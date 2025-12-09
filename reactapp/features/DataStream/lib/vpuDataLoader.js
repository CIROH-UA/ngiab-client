import { tableFromIPC } from "apache-arrow";
import appAPI from "features/Tethys/services/api/app";
import { saveArrowToCache, loadArrowFromCache, getCacheKey } from "./opfsCache";
import { getConnection } from "./duckdbClient";
import { getNCFiles } from "./s3Utils";

export async function debugSingleFeatureId(featureId) {
  const conn = await getConnection();

  const info = await conn.query(`
    SELECT
      COUNT(*) AS n_rows,
      MIN(time) AS min_time,
      MAX(time) AS max_time
    FROM vpu_data
    WHERE feature_id = ${featureId}
  `);

  const nRows = info.getChild("n_rows").get(0);
  const minTime = info.getChild("min_time").get(0);
  const maxTime = info.getChild("max_time").get(0);

  console.log(
    `[debugSingleFeatureId] feature_id=${featureId} → rows=${nRows},`,
    "min_time=", minTime,
    "max_time=", maxTime
  );

  if (nRows > 0n) {
    const sample = await conn.query(`
      SELECT feature_id, time, flow
      FROM vpu_data
      WHERE feature_id = ${featureId}
      ORDER BY time
      LIMIT 5
    `);

    const fCol = sample.getChild("feature_id");
    const tCol = sample.getChild("time");
    const qCol = sample.getChild("flow");

    console.log("[debugSingleFeatureId] sample rows:");
    for (let i = 0; i < sample.length; i++) {
      console.log(
        "  feature_id=",
        fCol.get(i),
        "time=",
        tCol.get(i),
        "flow=",
        qCol.get(i)
      );
    }
  }
}


export async function debugVpuTable() {
  const conn = await getConnection();

  const info = await conn.query(`
    SELECT
      COUNT(*) AS n_rows,
      MIN(feature_id) AS min_feature_id,
      MAX(feature_id) AS max_feature_id
    FROM vpu_data
  `);

  const nRows = info.getChild("n_rows").get(0);
  const minId = info.getChild("min_feature_id").get(0);
  const maxId = info.getChild("max_feature_id").get(0);

  console.log("[debugVpuTable] rows:", nRows, "min_id:", minId, "max_id:", maxId);

  const sample = await conn.query(`
    SELECT feature_id, time, flow
    FROM vpu_data
    LIMIT 5
  `);

  const fCol = sample.getChild("feature_id");
  const tCol = sample.getChild("time");
  const qCol = sample.getChild("flow");

  console.log("[debugVpuTable] sample rows:");
  for (let i = 0; i < sample.length; i++) {
    console.log(
      "  feature_id=",
      fCol.get(i),
      "time=",
      tCol.get(i),
      "flow=",
      qCol.get(i)
    );
  }
}
export async function debugFeatureIds() {
  const conn = await getConnection();

  const ids = await conn.query(`
    SELECT feature_id
    FROM vpu_data
    GROUP BY feature_id
    ORDER BY feature_id
  `);

  const idCol = ids.getChild("feature_id");
  console.log("[debugFeatureIds] distinct feature_id values:");
  for (let i = 0; i < ids.length; i++) {
    console.log("  ", idCol.get(i), " (typeof:", typeof idCol.get(i), ")");
  }
}



export async function loadVpuData(
   
    model,
    date,
    forecast,
    cycle,
    time,
    vpu,
    vpu_gpkg 
  ) { 
  
  const cacheKey = getCacheKey(model, date , forecast, cycle, time, vpu);
  console.log("loadVpuData called with cacheKey:", cacheKey);

  let buffer = await loadArrowFromCache(cacheKey);

  if (!buffer) {
    const nc_files = await getNCFiles(model, date , forecast, cycle, time, vpu);
    if (nc_files.length === 0) {
      throw new Error(`No NC files found for VPU ${vpu} with prefix.`);
    }
    const res = await appAPI.getParquetPerVpu({
      nc_files,
      vpu_gpkg,
    });
    buffer = res; // ArrayBuffer from axios
    await saveArrowToCache(cacheKey, buffer);
  }

  const arrowTable = tableFromIPC(new Uint8Array(buffer));

  const conn = await getConnection();

  const existsResult = await conn.query(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_name = '${cacheKey}'
  `);

  // DuckDB JS usually returns an Arrow Table; adapt depending on your wrapper:
  const exists = existsResult.toArray()[0].cnt > 0;

  if (!exists) {
    await conn.insertArrowTable(arrowTable, { name: cacheKey });
  } else {
    console.log(`Table "${cacheKey}" already exists, skipping insertArrowTable.`);
  }
}

export async function getVariables({ cacheKey }) {
  console.log("getVariables called with cacheKey:", cacheKey);

  const conn = await getConnection();

  const q = await conn.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = '${cacheKey}'
      AND column_name NOT IN (
        'ngen_id', 'usgs_id', 'nwm_id', 'feature_id', 'time', 'type'
      )
  `);

  const cols = (await q.toArray()).map(r => r.column_name);
  return cols;
}



