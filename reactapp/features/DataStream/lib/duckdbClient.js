// // duckdbClient.js
// import * as duckdb from "@duckdb/duckdb-wasm";

// let dbPromise = null;

// export function getDuckDB() {
//   if (!dbPromise) {
//     dbPromise = (async () => {
//       const bundles = duckdb.getJsDelivrBundles();
//       const bundle = await duckdb.selectBundle(bundles);
//       const worker = new Worker(bundle.mainWorker);
//       const logger = new duckdb.ConsoleLogger();
//       const db = new duckdb.AsyncDuckDB(logger, worker);
//       await db.instantiate(bundle.mainModule);
//       return db;
//     })();
//   }
//   return dbPromise;
// }

// export async function getConnection() {
//   const db = await getDuckDB();
//   return await db.connect();
// }

// duckdbClient.js
import * as duckdb from "@duckdb/duckdb-wasm";

let dbPromise = null;

export function getDuckDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

      // ✅ Create a same-origin blob worker that imports the real worker
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

