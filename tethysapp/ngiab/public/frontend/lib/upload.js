// Sending an archive, with progress, to wherever the server says it should go.
//
// XMLHttpRequest rather than fetch, for one reason: fetch reports no upload progress. A
// multi-gigabyte transfer with no indication of movement is indistinguishable from a hung
// one, and the whole point of the presigned route is that the archive can be that large.

import { csrfToken } from '../api/client.js';

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

// Straight into the bucket. The archive never passes through the portal, so a large upload
// does not occupy the single worker that is also serving every other request.
function putPresigned(url, file, onProgress) {
  const request = new XMLHttpRequest();
  request.open('PUT', url, true);
  request.setRequestHeader('Content-Type', 'application/octet-stream');
  return send(request, file, onProgress);
}

// No bucket configured, so the portal takes the bytes itself.
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

// An object rather than bare exports, so a test can replace a transfer without a server to
// receive it. Same shape as appAPI, and swapped the same way.
const transfer = { putPresigned, postToPortal };

export default transfer;
