import appAPI from '../api/app.js';
import { store, actions } from '../store/app-store.js';

// <ngiab-model-runs> -- pick which model run to view.
//
// Replaces the React ModelRuns select and the ?model_run_id= URL parameter as the only way
// in. The registry lives in the database now, so this also offers unregistering; that
// removes the row only, never the run directory on disk.
//
// The URL is kept in sync via history.replaceState so a run stays shareable as a link,
// which was the one genuinely good property of the query-parameter approach.
export class NgiabModelRuns extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <label class="runs-label" for="model-run-select">Model run</label>
      <div class="runs-row">
        <select id="model-run-select"></select>
        <button id="model-run-remove" type="button" title="Unregister this run">&times;</button>
      </div>
      <div class="runs-status" id="model-run-status"></div>
    `;

    this._selectEl = this.querySelector('#model-run-select');
    this._removeEl = this.querySelector('#model-run-remove');
    this._statusEl = this.querySelector('#model-run-status');

    this._selectEl.addEventListener('change', () => this._choose(this._selectEl.value));
    this._removeEl.addEventListener('click', () => this._remove());

    this.refresh();
  }

  async refresh() {
    try {
      const body = await appAPI.getModelRuns();
      this._runs = body.model_runs ?? [];
    } catch (error) {
      console.error('[model-runs] could not load', error);
      this._runs = [];
      this._setStatus(`Could not load model runs: ${error.message}`, 'error');
      return;
    }

    if (!this._runs.length) {
      this._setStatus('No model runs registered. Import one with viewOnTethys.sh -d <path>.', 'warning');
      this._selectEl.replaceChildren();
      this._selectEl.disabled = true;
      this._removeEl.disabled = true;
      return;
    }

    this._selectEl.disabled = false;
    this._removeEl.disabled = false;
    this._setStatus('');

    // Labels are frequently identical (the same gage registered repeatedly), so the id
    // fragment is appended to keep the options distinguishable.
    this._selectEl.replaceChildren(
      ...this._runs.map((run) => {
        const option = document.createElement('option');
        option.value = run.value;
        option.textContent = `${run.label} · ${String(run.value).slice(0, 8)}`;
        return option;
      }),
    );

    // Prefer whatever is already selected (the URL, on first load); otherwise take the
    // first run so the app is never sitting on an empty map with runs available.
    const current = store.get().modelRunId;
    const known = this._runs.some((r) => r.value === current);
    const chosen = known ? current : this._runs[0].value;
    this._selectEl.value = chosen;
    if (chosen !== current) this._choose(chosen);
  }

  _choose(modelRunId) {
    if (!modelRunId || modelRunId === store.get().modelRunId) return;
    actions.setModelRun(modelRunId);

    // Keep the run shareable as a link without adding a history entry per change.
    const url = new URL(window.location.href);
    url.searchParams.set('model_run_id', modelRunId);
    window.history.replaceState({}, '', url);
  }

  async _remove() {
    const modelRunId = this._selectEl.value;
    if (!modelRunId) return;

    const run = this._runs.find((r) => r.value === modelRunId);
    const label = run ? run.label : modelRunId;
    // Native confirm rather than a modal widget: unregistering is destructive enough to
    // deserve a prompt, and not frequent enough to deserve a component.
    if (!window.confirm(`Unregister "${label}"?\n\nThe run directory on disk is not deleted.`)) {
      return;
    }

    this._removeEl.disabled = true;
    try {
      await appAPI.removeModelRun({ model_run_id: modelRunId });
    } catch (error) {
      console.error('[model-runs] remove failed', error);
      this._setStatus(`Could not unregister: ${error.message}`, 'error');
      this._removeEl.disabled = false;
      return;
    }

    // Clear the selection so the map does not keep showing a run that no longer exists.
    actions.setModelRun(null);
    await this.refresh();
  }

  _setStatus(message, severity = null) {
    this._statusEl.textContent = message;
    this._statusEl.hidden = !message;
    this._statusEl.dataset.severity = message && severity ? severity : '';
  }
}

customElements.define('ngiab-model-runs', NgiabModelRuns);
