import { getConnection } from "./duckdbClient"

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
