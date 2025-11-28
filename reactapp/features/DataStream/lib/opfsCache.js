const CACHE_DIR = "ngiab-arrow-cache";

async function getCacheDir() {
  if (!("storage" in navigator) || !navigator.storage.getDirectory) {
    // OPFS not supported (e.g., non-Chromium / http)
    return null;
  }
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(CACHE_DIR, { create: true });
}

export async function saveArrowToCache(key, buffer) {
  const dir = await getCacheDir();
  if (!dir) return; // noop if OPFS unavailable

  const safeName = encodeURIComponent(key) + ".arrow";
  const fileHandle = await dir.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();

  // 🔍 Make sure we always pass a proper binary type to write()
  let dataToWrite;

  if (buffer instanceof ArrayBuffer) {
    dataToWrite = new Uint8Array(buffer);
  } else if (ArrayBuffer.isView(buffer)) {
    // covers Uint8Array, DataView, etc.
    dataToWrite = new Uint8Array(buffer.buffer);
  } else if (buffer instanceof Blob) {
    dataToWrite = buffer;
  } else {
    console.error("saveArrowToCache: unexpected buffer type", buffer);
    throw new Error("saveArrowToCache: expected ArrayBuffer, TypedArray, or Blob");
  }

  await writable.write(dataToWrite);
  await writable.close();
}

export async function loadArrowFromCache(key) {
  const dir = await getCacheDir();
  if (!dir) return null;

  const safeName = encodeURIComponent(key) + ".arrow";
  try {
    const fileHandle = await dir.getFileHandle(safeName);
    const file = await fileHandle.getFile();
    return await file.arrayBuffer(); // back to ArrayBuffer for Arrow/duckdb
  } catch (e) {
    return null; // cache miss
  }
}

