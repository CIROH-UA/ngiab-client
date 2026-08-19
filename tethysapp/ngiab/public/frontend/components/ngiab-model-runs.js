import appAPI from '../api/app.js';
import { store, actions } from '../store/app-store.js';
import { userMessage } from '../lib/errors.js';

// <ngiab-model-runs> -- pick which model run to view.
export class NgiabModelRuns extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <label class="field-label" for="model-run-select">Model run</label>
      <div class="runs-row">
        <select id="model-run-select"></select>
        <button id="model-run-remove" type="button" class="icon-button"
                aria-label="Unregister this run" title="Unregister this run">&times;</button>
      </div>
      <div class="status" id="model-run-status" role="status"></div>

      <button id="model-run-add" type="button" class="icon-button" aria-expanded="false"
              aria-controls="model-run-import">Add a run</button>
      <div id="model-run-import" hidden>
        <h4 class="field-label">Directories the visualizer can see</h4>
        <ul id="model-run-candidates"></ul>
        <div class="status" id="model-run-import-status" role="status"></div>
      </div>
    `;

    this._selectEl = this.querySelector('#model-run-select');
    this._removeEl = this.querySelector('#model-run-remove');
    this._statusEl = this.querySelector('#model-run-status');
    this._addEl = this.querySelector('#model-run-add');
    this._importEl = this.querySelector('#model-run-import');
    this._candidatesEl = this.querySelector('#model-run-candidates');
    this._importStatusEl = this.querySelector('#model-run-import-status');

    this._selectEl.addEventListener('change', () => this._choose(this._selectEl.value));
    this._removeEl.addEventListener('click', () => this._remove());
    this._addEl.addEventListener('click', () => this._toggleImport());

    this.refresh();
  }

  async refresh() {
    try {
      const body = await appAPI.getModelRuns();
      this._runs = body.model_runs ?? [];
    } catch (error) {
      console.error('[model-runs] could not load', error);
      this._runs = [];
      this._setStatus(this._statusEl, `Could not load model runs. ${userMessage(error)}`, 'error');
      return;
    }

    if (!this._runs.length) {
      this._setStatus(this._statusEl, 'No model runs registered yet. Add one below.', 'warning');
      this._selectEl.replaceChildren();
      this._selectEl.disabled = true;
      this._removeEl.disabled = true;
      return;
    }

    this._selectEl.disabled = false;
    this._removeEl.disabled = false;
    this._setStatus(this._statusEl, '');

    // Labels repeat across runs, so the id fragment keeps options distinguishable.
    this._selectEl.replaceChildren(
      ...this._runs.map((run) => {
        const option = document.createElement('option');
        option.value = run.value;
        option.textContent = `${run.label} · ${String(run.value).slice(0, 8)}`;
        return option;
      }),
    );

    // Keep the current selection if still valid, else fall back to the first run.
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
    // Native confirm: destructive enough to prompt, too rare to justify a widget.
    if (!window.confirm(`Unregister "${label}"?\n\nThe run directory on disk is not deleted.`)) {
      return;
    }

    this._removeEl.disabled = true;
    try {
      await appAPI.removeModelRun({ model_run_id: modelRunId });
    } catch (error) {
      console.error('[model-runs] remove failed', error);
      this._setStatus(this._statusEl, `Could not unregister that run. ${userMessage(error)}`, 'error');
      this._removeEl.disabled = false;
      return;
    }

    // Clear the selection so the map does not keep showing a run that no longer exists.
    actions.setModelRun(null);
    await this.refresh();
  }

  _toggleImport() {
    const opening = this._importEl.hidden;
    this._importEl.hidden = !opening;
    this._addEl.setAttribute('aria-expanded', String(opening));
    if (opening) this._scan();
  }

  async _scan() {
    this._setStatus(this._importStatusEl, 'Looking for runs...');
    let candidates;
    try {
      ({ candidates } = await appAPI.scanModelRuns());
    } catch (error) {
      console.error('[model-runs] scan failed', error);
      this._setStatus(this._importStatusEl, `Could not look for runs. ${userMessage(error)}`, 'error');
      return;
    }

    this._candidatesEl.replaceChildren(...candidates.map((c) => this._candidateRow(c)));
    const addable = candidates.some((c) => c.importable && !c.registered);
    this._setStatus(
      this._importStatusEl,
      addable ? '' : 'Nothing here to add. Copy a run into the visualizer directory first.',
      'info',
    );
  }

  // Unusable directories are listed with the reason: invisible would read as a bug.
  _candidateRow(candidate) {
    const row = document.createElement('li');
    row.className = 'candidate';

    const name = document.createElement('span');
    name.className = 'candidate-name';
    name.textContent = candidate.directory;
    row.append(name);

    if (candidate.registered || !candidate.importable) {
      const note = document.createElement('span');
      note.className = 'candidate-note';
      note.textContent = candidate.registered ? 'already registered' : candidate.reason;
      if (!candidate.registered) row.dataset.severity = 'warning';
      row.append(note);
      return row;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.textContent = 'Add';
    button.addEventListener('click', () => this._register(candidate.directory, button));
    row.append(button);
    return row;
  }

  async _register(directory, button) {
    button.disabled = true;
    this._setStatus(this._importStatusEl, `Adding ${directory}...`);
    try {
      await appAPI.registerModelRun({ directory });
    } catch (error) {
      console.error('[model-runs] register failed', error);
      this._setStatus(this._importStatusEl, `Could not add ${directory}. ${userMessage(error)}`, 'error');
      button.disabled = false;
      return;
    }

    await this.refresh();
    await this._scan();
  }

  _setStatus(el, message, severity = null) {
    el.textContent = message;
    el.hidden = !message;
    el.dataset.severity = message && severity ? severity : '';
  }
}

customElements.define('ngiab-model-runs', NgiabModelRuns);
