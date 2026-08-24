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

// A ceiling so a job that never reaches a terminal state stops being reported as 'Working…'
// forever. Generous: the server reports a stale job as failed well before this, and this is
// only the backstop for a status object that cannot be read at all.
const POLL_CEILING_MS = 60 * 60 * 1000;

// Consecutive failed status checks tolerated before the loop gives up. The server answers a
// storage failure with a retryable status precisely so polling continues, but a dropped
// connection never reaches it -- so the loop counts failures rather than reading a body.
const POLL_MAX_CONSECUTIVE_FAILURES = 5;

export class NgiabUploadRun extends HTMLElement {
  connectedCallback() {
    // Reset, so a moved element is not left inert by its own disconnectedCallback.
    this._stopped = false;
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

  // Else the poll loop outlives the element, firing run-published from a detached node.
  disconnectedCallback() {
    this._stopped = true;
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
    const started = Date.now();
    let failures = 0;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (this._stopped || !this.isConnected) return undefined;

      if (Date.now() - started > POLL_CEILING_MS) {
        this._busy(false);
        this._progressEl.hidden = true;
        return this._say(
          'This upload is taking longer than expected. It may still finish \u2014 reload to '
          + 'check whether the run appeared.',
          'warning',
        );
      }

      let status;
      try {
        status = await appAPI.uploadStatus({ job });
        failures = 0;
      } catch (error) {
        // Re-checked: the element can be removed while the request is in flight.
        if (this._stopped || !this.isConnected) return undefined;

        failures += 1;
        if (error.retryable && failures < POLL_MAX_CONSECUTIVE_FAILURES) {
          this._say('Still working. The server is briefly unreachable…', 'warning');
          continue;
        }
        this._busy(false);
        return this._say(userMessage(error), 'error');
      }

      if (this._stopped || !this.isConnected) return undefined;
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
