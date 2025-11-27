import { tableFromIPC } from "apache-arrow";
import appAPI from "services/api/app";
import { saveArrowToCache, loadArrowFromCache } from "./opfsCache";
import { getConnection } from "./duckdbClient";

export async function loadVpuData({ cacheKey, nc_files, vpu_gpkg }) {
  // 1) Try OPFS cache
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

  // Name table per VPU/forecast if you like; here "vpu_data"
  // Exact method name can vary by duckdb-wasm version:
  await conn.insertArrowTable(arrowTable, { name: "vpu_data" });

  // 5) Example: query and turn into simple JS rows
  const result = await conn.query(`
    SELECT *
    FROM vpu_data
    ORDER BY time
  `);

  const rows = [];
  for (const row of result) {
    // duckdb-wasm rows often have toJSON()/toObject() helpers;
    // you may need to adjust depending on version.
    rows.push(row.toJSON ? row.toJSON() : row);
  }

  return rows;
}
