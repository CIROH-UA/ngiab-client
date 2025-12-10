// // nexusTimeseries.js
import { tableFromIPC } from "apache-arrow";
import appAPI from "features/Tethys/services/api/app";
import { saveArrowToCache, loadArrowFromCache, getCacheKey } from "./opfsCache";
import { getConnection } from "./duckdbClient";
import { getNCFiles } from "./s3Utils";

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

export async function loadIndexData({ remoteUrl }) {
  const cacheKey = "index_data_table";
  console.log("loadIndexData called with cacheKey:", cacheKey);

  const conn = await getConnection();

  // Escape double quotes in table name, just in case
  const tableName = cacheKey.replace(/"/g, '""');

  // 1) Check if table already exists
  const existsResult = await conn.query(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_schema = 'main'
      AND table_name = '${tableName}'
  `);

  const rows = existsResult.toArray();
  const exists = rows[0].cnt > 0;

  if (exists) {
    console.log(`Table "${cacheKey}" already exists, skipping load.`);
    return;
  }

  // 2) Make sure HTTP/Parquet support is loaded
  await conn.query("INSTALL httpfs; LOAD httpfs;");
  await conn.query("INSTALL parquet; LOAD parquet;");

  // 3) Create table from remote Parquet file
  await conn.query(`
    CREATE TABLE "${tableName}" AS
    SELECT * FROM read_parquet('${remoteUrl}')
  `);

  console.log(`Created table "${cacheKey}" from remote parquet ${remoteUrl}`);
}

export async function getFeatureProperties({ cacheKey, feature_id }) {
  console.log("getFeature called with cacheKey:", cacheKey, "feature_id:", feature_id);

  const conn = await getConnection();

  const q = await conn.query(`
    SELECT *
    FROM "${cacheKey}"
    WHERE id = '${feature_id}'
  `);

  
  const rows = q.toArray().map(Object.fromEntries);
  rows.columns = q.schema.fields.map((d) => d.name);


  console.log(
    `[getFeatureProperties] (literal) id=${feature_id} rows=${rows.length}`
  );
  return rows
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
  buffer = null; // free memory
}


export async function dropAllVpuDataTables() {
  const conn = await getConnection();

  // Find all tables in 'main' whose name includes 'VPU_'
  const result = await conn.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'main'
      AND table_type = 'BASE TABLE'
      AND table_name LIKE '%VPU_%'
  `);

  // Adapt to your Arrow → JS conversion (same as in loadVpuData)
  const rows = result.toArray();

  if (!rows.length) {
    console.log('No VPU cache tables found to drop.');
    return;
  }

  for (const row of rows) {
    const schema = row.table_schema;
    const name = row.table_name;

    // Quote identifiers to be safe
    const fullName = `"${schema}"."${name}"`;
    console.log(`Dropping table ${fullName}...`);

    await conn.query(`DROP TABLE IF EXISTS ${fullName}`);
  }

  console.log('Finished dropping VPU cache tables.');
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



