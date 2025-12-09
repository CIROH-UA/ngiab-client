import { getCacheKey, loadArrowFromCache } from "./opfsCache";

export async function listPublicS3Directories(prefix = "v2.2/") {
  const bucket = "ciroh-community-ngen-datastream";

  // Ensure trailing slash
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  // S3 ListObjectsV2 with delimiter to get “folders”
  const url =
    `https://${bucket}.s3.us-east-1.amazonaws.com/` +
    `?list-type=2&prefix=${encodeURIComponent(normalizedPrefix)}` +
    `&delimiter=/`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`S3 list error: ${resp.status} ${resp.statusText}`);
  }

  const xml = await resp.text();

  // Parse XML and extract CommonPrefixes/Prefix
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  const prefixNodes = [...doc.getElementsByTagName("CommonPrefixes")];

  // Full prefixes from S3, e.g. "v2.2/ngen.20251121/short_range/"
  const fullPrefixes = prefixNodes
    .map((node) => node.getElementsByTagName("Prefix")[0]?.textContent)
    .filter(Boolean);

  // If you only want the "child" folder names (e.g. just "ngen.20251121"):
  const childNames = fullPrefixes.map((p) =>
    p
      .slice(normalizedPrefix.length) // remove base prefix
      .replace(/\/$/, "")            // trim trailing slash
  );

  return { fullPrefixes, childNames };
}

export async function listPublicS3Files(prefix = "v2.2/") {
    const bucket = "ciroh-community-ngen-datastream";
    const url =
        `https://${bucket}.s3.us-east-1.amazonaws.com` +
        `/?list-type=2&prefix=${encodeURIComponent(prefix)}`;


    const resp = await fetch(url);
    const xml = await resp.text();

    // parse XML -> extract <Key> elements
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const contents = [...doc.getElementsByTagName("Contents")];

    return contents.map(node => node.getElementsByTagName("Key")[0].textContent);
}

export const makePrefix = (model, avail_date,ngen_forecast,ngen_cycle, ngen_time, ngen_vpu) => {    
    let prefix_path = `outputs/${model}/v2.2_hydrofabric/${avail_date}/${ngen_forecast}/${ngen_cycle}`
    let time_path = ngen_time ? `${ngen_time}/` : '';
    prefix_path = `${prefix_path}/${time_path}${ngen_vpu}/ngen-run/outputs/troute/`;
    return prefix_path;
}

export async function getNCFiles(model, date, forecast, cycle, time, vpu, buffer) {
    if (buffer){ return []; }
    const prefix = makePrefix(model, date, forecast, cycle, time, vpu);
    const filesPrefix = await listPublicS3Files(prefix);
    console.log("files_prefix", filesPrefix);
    const ncFiles = filesPrefix.filter(f => f.endsWith('.nc'));
    const ncFilesParsed = ncFiles.map(f => `s3://ciroh-community-ngen-datastream/${f}`);
    return ncFilesParsed;
}

export const makeGpkgUrl = (vpu) => {
    const vpu_gpkg = `s3://ciroh-community-ngen-datastream/v2.2_resources/${vpu}/config/nextgen_${vpu}.gpkg`;
    return vpu_gpkg;
}