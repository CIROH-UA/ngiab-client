import appAPI from '../api/app.js';
import { store, actions } from '../store/app-store.js';
import { userMessage } from '../lib/errors.js';
import { canSeeDelete } from '../config.js';

// <ngiab-model-runs> -- pick which model run to view.
export class NgiabModelRuns extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <label class="field-label" for="model-run-select">Model run</label>
      <div class="runs-row">
        <select id="model-run-select"></select>
        <button id="model-run-remove" type="button" class="icon-button"
                aria-label="Delete this run" title="Delete this run">&times;</button>
      </div>
      <div class="status" id="model-run-status" role="status"></div>
    `;

    this._selectEl = this.querySelector('#model-run-select');
    this._removeEl = this.querySelector('#model-run-remove');

    // Removed, not disabled: a greyed control invites a hunt for what would enable it.
    if (!canSeeDelete()) {
      this._removeEl.remove();
      this._removeEl = null;
    }
    this._statusEl = this.querySelector('#model-run-status');
    this._selectEl.addEventListener('change', () => this._choose(this._selectEl.value));
    this._removeEl?.addEventListener('click', () => this._remove());

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
      this._setStatus(
        this._statusEl,
        'No model runs yet. Copy a run directory into the visualizer\u2019s storage and it '
        + 'will appear here.',
        'warning',
      );
      this._selectEl.replaceChildren();
      this._selectEl.disabled = true;
      if (this._removeEl) this._removeEl.disabled = true;
      return;
    }

    this._selectEl.disabled = false;
    if (this._removeEl) this._removeEl.disabled = false;
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
    // The button is absent without the permission; the server refuses regardless.
    if (!this._removeEl) return;

    const modelRunId = this._selectEl.value;
    if (!modelRunId) return;

    const run = this._runs.find((r) => r.value === modelRunId);
    const label = run ? run.label : modelRunId;

    // Native confirm: destructive enough to prompt, too rare to justify a widget.
    if (!window.confirm(
      `Delete "${label}"?\n\nThis deletes the run's outputs from storage. `
      + 'It cannot be undone, and nothing else keeps a copy.',
    )) return;

    this._removeEl.disabled = true;
    try {
      await appAPI.removeModelRun({ model_run_id: modelRunId });
    } catch (error) {
      console.error('[model-runs] remove failed', error);
      this._setStatus(this._statusEl, `Could not delete that run. ${userMessage(error)}`, 'error');
      this._removeEl.disabled = false;
      return;
    }

    // Clear the selection so the map does not keep showing a run that no longer exists.
    actions.setModelRun(null);
    await this.refresh();
  }

  _setStatus(el, message, severity = null) {
    el.textContent = message;
    el.hidden = !message;
    el.dataset.severity = message && severity ? severity : '';
  }
}

customElements.define('ngiab-model-runs', NgiabModelRuns);
