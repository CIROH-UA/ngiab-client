import { tableFromIPC } from "apache-arrow";
import appAPI from "services/api/app";
import { saveArrowToCache, loadArrowFromCache } from "./opfsCache";
import { getConnection } from "./duckdbClient";

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
export async function loadVpuData({ baseCacheKey, nc_files, vpu_gpkg }) {
  // 1) Try OPFS cache
  const cacheKey = `${baseCacheKey}nc_file`;
  console.log("loadVpuData called with cacheKey:", cacheKey);
  let buffer = await loadArrowFromCache(cacheKey);

  // 2) If not cached, hit Django
  if (!buffer) {
    const res = await appAPI.getParquetPerVpu({
      nc_files,
      vpu_gpkg,
    });
    buffer = res; // ArrayBuffer from axios
    await saveArrowToCache(cacheKey, buffer);
  }

  // 3) Decode Arrow IPC to Arrow Table
  const arrowTable = tableFromIPC(new Uint8Array(buffer));

  // 4) Load into duckdb
  const conn = await getConnection();

  // Optional: clear old table when switching VPU
  // await conn.query("DROP TABLE IF EXISTS vpu_data");

  // Name table per VPU/forecast if you like; here "vpu_data"
  // Exact method name can vary by duckdb-wasm version:
  await conn.insertArrowTable(arrowTable, { name: "vpu_data" });


}

