import appAPI from '../api/app.js';
import { userMessage } from '../lib/errors.js';
import transfer from '../lib/upload.js';
import { canUpload } from '../config.js';

// <ngiab-upload-run> -- add a run by uploading its archive.
//
// Three steps, because the bytes do not come through the portal when it has a bucket:
// reserve a job and get somewhere to send the archive, send it, then ask the server to
// unpack it. Unpacking is another process and takes minutes on a large run, so the last
// step is a poll rather than a response.

const POLL_MS = 2000;

export class NgiabUploadRun extends HTMLElement {
  connectedCallback() {
    if (!canUpload()) return;

    this.innerHTML = `
      <details id="upload-panel">
        <summary>Upload a run</summary>
        <label class="field-label" for="upload-name">Name</label>
        <input id="upload-name" type="text" placeholder="gage-07144100" autocomplete="off">
        <label class="field-label" for="upload-file">Archive (.tar, .tar.gz, .zip)</label>
        <input id="upload-file" type="file" accept=".tar,.tar.gz,.tgz,.zip">
        <button id="upload-start" type="button">Upload</button>
        <progress id="upload-progress" max="1" value="0" hidden></progress>
        <div class="status" id="upload-status" role="status"></div>
      </details>
    `;

    this._nameEl = this.querySelector('#upload-name');
    this._fileEl = this.querySelector('#upload-file');
    this._startEl = this.querySelector('#upload-start');
    this._progressEl = this.querySelector('#upload-progress');
    this._statusEl = this.querySelector('#upload-status');

    this._startEl.addEventListener('click', () => this._upload());
    this._fileEl.addEventListener('change', () => this._suggestName());
  }

  // A run is usually archived under its own name, so offer that rather than nothing.
  _suggestName() {
    if (this._nameEl.value.trim()) return;
    const file = this._fileEl.files?.[0];
    if (!file) return;
    const stem = file.name.replace(/\.(tar\.gz|tgz|tar|zip)$/i, '');
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stem)) this._nameEl.value = stem;
  }

  _say(message, severity = '') {
    this._statusEl.textContent = message;
    if (severity) this._statusEl.dataset.severity = severity;
    else delete this._statusEl.dataset.severity;
  }

  _busy(on) {
    this._startEl.disabled = on;
    this._nameEl.disabled = on;
    this._fileEl.disabled = on;
    this._progressEl.hidden = !on;
  }

  async _upload() {
    const name = this._nameEl.value.trim();
    const file = this._fileEl.files?.[0];
    if (!name) return this._say('Give the run a name.', 'warning');
    if (!file) return this._say('Choose an archive to upload.', 'warning');

    this._busy(true);
    this._progressEl.value = 0;
    this._say('Reserving…');

    let ticket;
    try {
      ticket = await appAPI.createUpload({ name });
    } catch (error) {
      this._busy(false);
      return this._say(userMessage(error), 'error');
    }

    try {
      this._say('Uploading…');
      if (ticket.mode === 'presigned') {
        await transfer.putPresigned(ticket.url, file, (fraction) => {
          this._progressEl.value = fraction;
        });
        await appAPI.startUpload({ job: ticket.job, name });
      } else {
        await transfer.postToPortal(
          appAPI.uploadRunUrl(),
          { job: ticket.job, name, file },
          (fraction) => { this._progressEl.value = fraction; },
        );
      }
    } catch (error) {
      this._busy(false);
      return this._say(userMessage(error), 'error');
    }

    this._progressEl.removeAttribute('value');
    await this._await(ticket.job);
  }

  // Unpacking outlives the request that started it, so its outcome arrives by polling.
  async _await(job) {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));

      let status;
      try {
        status = await appAPI.uploadStatus({ job });
      } catch (error) {
        this._busy(false);
        return this._say(userMessage(error), 'error');
      }

      this._say(status.message || status.stage || 'Working…');
      if (!status.terminal) continue;

      this._busy(false);
      this._progressEl.hidden = true;
      if (status.state === 'failed') return this._say(status.message, 'error');

      this._say(`${status.run} is ready.`, 'info');
      this._nameEl.value = '';
      this._fileEl.value = '';
      // The picker is derived from storage, so it only has to be asked again.
      this.dispatchEvent(new CustomEvent('run-published', {
        bubbles: true,
        detail: { run: status.run },
      }));
      return undefined;
    }
  }
}

customElements.define('ngiab-upload-run', NgiabUploadRun);
