import * as duckdb from "@duckdb/duckdb-wasm";

let dbPromise = null;

export function getDuckDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
      const workerUrl = URL.createObjectURL(
        new Blob(
          [`importScripts("${bundle.mainWorker}");`],
          { type: "text/javascript" }
        )
      );

      const worker = new Worker(workerUrl);
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);

      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

      // Optional cleanup
      URL.revokeObjectURL(workerUrl);

      return db;
    })();
  }
  return dbPromise;
}

export async function getConnection() {
  const db = await getDuckDB();
  return await db.connect();
}

// OPTIONAL: wipe all DB state (tables, etc) but keep worker
export async function resetDatabase() {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.reset();
}

// OPTIONAL: fully tear down the worker (very heavy)
export async function terminateDatabase() {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.terminate();
  dbPromise = null;
}