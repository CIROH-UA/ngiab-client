import { csrfToken } from '../api/client.js';
import { maxUploadBytes } from '../config.js';

function describeBytes(count) {
  return `${(count / 1024 ** 3).toFixed(1)} GiB`;
}

function tooLarge(file) {
  if (!file || file.size <= maxUploadBytes()) return null;
  return (
    `${file.name} is ${describeBytes(file.size)}, over the `
    + `${describeBytes(maxUploadBytes())} limit for a single upload. `
    + 'Compress the run as .tar.gz and upload that.'
  );
}

function send(request, body, onProgress) {
  return new Promise((resolve, reject) => {
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) resolve(request);
      else reject(new Error(`Upload failed with HTTP ${request.status}`));
    });
    request.addEventListener('error', () => reject(new Error('The upload connection failed.')));
    request.addEventListener('abort', () => reject(new Error('The upload was cancelled.')));
    request.send(body);
  });
}

function putPresigned(url, file, onProgress) {
  const request = new XMLHttpRequest();
  request.open('PUT', url, true);
  request.setRequestHeader('Content-Type', 'application/octet-stream');
  return send(request, file, onProgress);
}

function postToPortal(url, { job, name, file }, onProgress) {
  const body = new FormData();
  body.append('job', job);
  body.append('name', name);
  body.append('archive', file);

  const request = new XMLHttpRequest();
  request.open('POST', url, true);
  const token = csrfToken();
  if (token) request.setRequestHeader('X-CSRFToken', token);
  return send(request, body, onProgress);
}

const transfer = { putPresigned, postToPortal, tooLarge, MAX_UPLOAD_BYTES: maxUploadBytes() };

export default transfer;
