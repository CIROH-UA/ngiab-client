import uPlot from 'uplot';

import appAPI from '../api/app.js';
import { store, actions } from '../store/app-store.js';
import { toUplotData } from '../lib/series.js';
import { toMetricsTable } from '../lib/metrics.js';
import { userMessage } from '../lib/errors.js';

// First-draw estimate for uPlot's legend row, before it exists to measure.
const LEGEND_ROW = 22;

// <ngiab-chart> -- the time-series panel.

const SOURCES = [
  { key: 'catchment', label: 'Catchment' },
  { key: 'troute', label: 'T-Route' },
  { key: 'teehr', label: 'TEEHR' },
];

export class NgiabChart extends HTMLElement {
  connectedCallback() {
    this._source = 'catchment';
    this._plot = null;
    this._requestSeq = 0; // guards against out-of-order responses
    this._lastSelectionKey = null;

    this.innerHTML = `
      <div class="chart-controls">
        <div class="chart-sources" role="tablist"></div>
        <label class="chart-variable">
          <span>Variable</span>
          <select id="chart-variable"></select>
        </label>
      </div>
      <div class="chart-status" id="chart-status" role="status">Select a catchment on the map.</div>
      <p class="chart-note" id="chart-note" hidden></p>
      <div class="chart-body">
        <div class="chart-canvas" id="chart-canvas"></div>
        <div class="chart-metrics" id="chart-metrics" hidden></div>
      </div>
    `;

    this._sourcesEl = this.querySelector('.chart-sources');
    this._variableEl = this.querySelector('#chart-variable');
    this._variableWrapEl = this.querySelector('.chart-variable');
    this._statusEl = this.querySelector('#chart-status');
    this._noteEl = this.querySelector('#chart-note');
    this._canvasEl = this.querySelector('#chart-canvas');
    this._metricsEl = this.querySelector('#chart-metrics');

    this._renderSourceButtons();

    this._variableEl.addEventListener('change', () => {
      this._setVariableForSource(this._variableEl.value);
      this.load();
    });

    // Redraw on container resize; uPlot needs explicit pixel sizes.
    this._resizeObserver = new ResizeObserver(() => this._resizePlot());
    this._resizeObserver.observe(this._canvasEl);

    this._unsubscribe = store.subscribe(() => this._onStoreChange());
    this._onStoreChange();
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._destroyPlot();
  }


  _onStoreChange() {
    const { selection, teehrId, theme } = store.get();

    // uPlot bakes colours in at construction, so a theme change repaints from the last data.
    if (theme !== this._lastTheme) {
      this._lastTheme = theme;
      if (this._lastDraw) {
        const { data, labels, layout } = this._lastDraw;
        this._draw(data, labels, layout);
      }
    }

    // Refetch only on a real feature change; the store also fires for theme and layers.
    const key = `${selection.type}:${selection.id}:${teehrId}`;
    if (key === this._lastSelectionKey) return;
    this._lastSelectionKey = key;

    this._renderSourceButtons();

    if (!selection.id) {
      this._destroyPlot();
      this._renderMetrics(null);
      this._setStatus('Select a catchment on the map.', 'info');
      this._variableWrapEl.hidden = true;
      return;
    }

    // TEEHR is only meaningful where a gauge is crosswalked.
    if (this._source === 'teehr' && !teehrId) this._source = 'catchment';

    this.load();
  }

  _setVariableForSource(value) {
    const v = value || null;
    if (this._source === 'teehr') actions.setTeehrVariable(v);
    else if (this._source === 'troute') actions.setTrouteVariable(v);
    else actions.setVariable(v);
    // Keep the key in step so our own notification is not read as a new feature.
    const { selection, teehrId } = store.get();
    this._lastSelectionKey = `${selection.type}:${selection.id}:${teehrId}`;
  }

  _variableForSource() {
    const s = store.get();
    if (this._source === 'teehr') return s.teehrVariable;
    if (this._source === 'troute') return s.trouteVariable;
    return s.variable;
  }


  async load() {
    const { selection, modelRunId, trouteId, teehrId } = store.get();
    if (!selection.id) return;

    const seq = (this._requestSeq += 1);
    this._setBusy(true);
    this._setStatus('Loading...');

    try {
      const payload = await this._fetchSource({ selection, modelRunId, trouteId, teehrId });
      // A slower earlier request must not overwrite a newer one.
      if (seq !== this._requestSeq) return;
      this._renderPayload(payload);
    } catch (error) {
      if (seq !== this._requestSeq) return;
      console.error('[chart] fetch failed', error);
      this._destroyPlot();
      this._renderMetrics(null);
      this._setNote(null);
      this._setStatus(userMessage(error), 'error');
    } finally {
      if (seq === this._requestSeq) this._setBusy(false);
    }
  }

  _fetchSource({ selection, modelRunId, trouteId, teehrId }) {
    const variable = this._variableForSource();

    if (this._source === 'troute') {
      return appAPI.getTrouteTimeSeries({
        model_run_id: modelRunId,
        troute_id: trouteId,
        troute_variable: variable,
      });
    }

    if (this._source === 'teehr') {
      return appAPI.getTeehrTimeSeries({
        model_run_id: modelRunId,
        teehr_id: teehrId,
        teehr_variable: variable,
      });
    }

    return appAPI.getCatchmentTimeSeries({
      model_run_id: modelRunId,
      catchment_id: selection.label,
      variable_column: variable,
    });
  }


  // What the series actually is, when that differs from what was clicked on the map.
  _setNote(note) {
    this._noteEl.textContent = note ?? '';
    this._noteEl.hidden = !note;
  }

  _renderPayload(payload) {
    this._setNote(payload.note);

    // TEEHR reports 'cannot answer' as a status with a severity, not as an error.
    if (payload.teehr_status) {
      this._destroyPlot();
      this._renderMetrics(null);
      this._setStatus(payload.teehr_status, payload.teehr_status_severity || 'info');
      this._renderVariableOptions(payload);
      return;
    }

    const { data, labels, points } = toUplotData(payload.data);
    this._renderVariableOptions(payload);
    this._renderMetrics(payload.metrics);

    if (!points) {
      this._destroyPlot();
      this._setStatus('No data for this selection.', 'info');
      return;
    }

    this._setStatus('');
    this._draw(data, labels, payload.layout);
  }

  _renderVariableOptions(payload) {
    // Each endpoint names its variable list differently.
    const raw =
      payload.variables ?? payload.troute_variables ?? payload.teehr_variables ?? null;

    if (!raw || !raw.length) {
      this._variableWrapEl.hidden = true;
      return;
    }

    const options = raw.map((v) =>
      typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label ?? v.value },
    );
    const current = this._variableForSource() ?? payload.variable ?? options[0].value;

    this._variableWrapEl.hidden = false;
    this._variableEl.textContent = '';
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      el.selected = opt.value === current;
      this._variableEl.append(el);
    }
  }

  _renderSourceButtons() {
    const { selection, teehrId } = store.get();
    this._sourcesEl.textContent = '';

    for (const source of SOURCES) {
      if (source.key === 'teehr' && !teehrId) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = source.label;
      button.className = source.key === this._source ? 'is-active' : '';
      button.disabled = !selection.id;
      button.addEventListener('click', () => {
        if (this._source === source.key) return;
        this._source = source.key;
        this._renderSourceButtons();
        this.load();
      });
      this._sourcesEl.append(button);
    }
  }

  _draw(data, labels, layout) {
    this._destroyPlot();

    // Set after _destroyPlot, which clears it: a repaint must not wipe its own source.
    this._lastDraw = { data, labels, layout };

    const token = (name) => getComputedStyle(this).getPropertyValue(name).trim();
    const stroke = token('--fg');
    const grid = token('--grid');
    const palette = [token('--series-1'), token('--series-2'), token('--series-3')];

    this._plot = new uPlot(
      {
        width: this._canvasEl.clientWidth || 600,
        height: Math.max((this._canvasEl.clientHeight || 260) - LEGEND_ROW, 80),
        // uPlot's built-in cursor replaces the separate @visx tooltip component.
        cursor: { drag: { x: true, y: false } },
        axes: [
          { stroke, grid: { show: true, stroke: grid } },
          { stroke, label: layout?.yaxis || '', grid: { show: true, stroke: grid } },
        ],
        series: [
          {},
          ...labels.map((label, i) => ({
            label,
            stroke: palette[i % palette.length],
            width: 1.5,
            // Do not bridge nulls: a gap in the record should read as a gap.
            spanGaps: false,
          })),
        ],
      },
      data,
      this._canvasEl,
    );

    // Now that the legend exists, size the plot to what it actually left behind.
    this._resizePlot();

    this._settleSize();
  }

  /**
   * Re-measure until the plot matches the box that holds it.
   *
   * A theme repaint recreates the plot while the restyle is still in flight, so the height
   * read at construction can be the 80px floor. One frame is not reliably enough -- the
   * second toggle still landed short -- and nothing corrects it afterwards, because
   * #chart-canvas keeps its flex height throughout and the ResizeObserver never fires.
   */
  _settleSize(attempts = 8) {
    if (this._pendingResize) cancelAnimationFrame(this._pendingResize);

    this._pendingResize = requestAnimationFrame(() => {
      this._pendingResize = null;
      if (!this._plot) return;

      const target = this._plotHeight();
      if (this._plot.height !== target) this._resizePlot();
      if (attempts > 1 && this._plot.height !== target) this._settleSize(attempts - 1);
    });
  }

  // uPlot sizes only the canvas, so the plot takes the height left after its legend.
  _plotHeight() {
    const total = this._canvasEl.clientHeight || 260;
    const measured = this._plot?.root?.querySelector('.u-legend')?.offsetHeight ?? 0;

    // Measured mid-layout the legend reads 173px inside a 154px box; past half is not real.
    const legend = measured < total / 2 ? measured : LEGEND_ROW;
    return Math.max(total - legend, 80);
  }

  _resizePlot() {
    if (!this._plot) return;
    this._plot.setSize({
      width: this._canvasEl.clientWidth || 600,
      height: this._plotHeight(),
    });
  }

  _destroyPlot() {
    if (this._pendingResize) {
      cancelAnimationFrame(this._pendingResize);
      this._pendingResize = null;
    }
    this._lastDraw = null;
    if (this._plot) {
      this._plot.destroy();
      this._plot = null;
    }
  }

  // Columns come from the payload: configuration names are run-specific.
  _renderMetrics(metrics) {
    const { columns, rows } = toMetricsTable(metrics);
    this._metricsEl.textContent = '';

    if (!rows.length) {
      this._metricsEl.hidden = true;
      return;
    }

    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    head.insertCell().textContent = '';
    for (const col of columns) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = col.label;
      head.append(th);
    }

    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row.label;
      tr.append(th);
      for (const value of row.values) {
        tr.insertCell().textContent = value;
      }
    }

    this._metricsEl.append(table);
    this._metricsEl.hidden = false;
  }

  // Disable controls in flight so clicks cannot queue out-of-order requests.
  _setBusy(busy) {
    this.classList.toggle('is-busy', busy);
    this._variableEl.disabled = busy;
    for (const button of this._sourcesEl.querySelectorAll('button')) {
      button.disabled = busy || !store.get().selection.id;
    }
  }

  _setStatus(message, severity = null) {
    this._statusEl.textContent = message;
    this._statusEl.hidden = !message;
    this._statusEl.dataset.severity = message && severity ? severity : '';
  }
}

customElements.define('ngiab-chart', NgiabChart);
