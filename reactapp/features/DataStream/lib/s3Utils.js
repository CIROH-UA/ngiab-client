import { S3Client, ListObjectsCommand, GetObjectCommand } from "@aws-sdk/client-s3";


const s3Client = new S3Client({
    region: "auto",
});

export const listS3Files = async (bucketName='ciroh-community-ngen-datastream', prefix='v2.2') => {
  const command = new ListObjectsCommand({ Bucket: bucketName, Prefix: prefix });
  const response = await s3Client.send(command);
  return response.Contents.map(file => `${prefix}/${file.Key}`);
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

export const makePrefix = (avail_date,ngen_forecast,ngen_cycle, ngen_time, ngen_vpu) => {    
    let prefix_path = `v2.2/${avail_date}/${ngen_forecast}/${ngen_cycle}`
    let time_path = ngen_time ? `${ngen_time}/` : '';
    prefix_path = `${prefix_path}/${time_path}${ngen_vpu}/ngen-run/outputs/`;
    return prefix_path;
}
