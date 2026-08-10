import uPlot from 'uplot';

import appAPI from '../api/app.js';
import { store, actions } from '../store/app-store.js';
import { toUplotData } from '../lib/series.js';
import { toMetricsTable } from '../lib/metrics.js';

// <ngiab-chart> -- the time-series panel.
//
// Replaces the React chart.js (@visx) plus the catchment / troute / teehr select
// components. One element covers all three sources because they share an envelope:
//   { data: [ { label, data: [{x, y}] } ], layout: { yaxis } }
//
// Renders into light DOM so the app stylesheet applies, per the design spec.

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
      <div class="chart-status" id="chart-status">Select a catchment on the map.</div>
      <div class="chart-body">
        <div class="chart-canvas" id="chart-canvas"></div>
        <div class="chart-metrics" id="chart-metrics" hidden></div>
      </div>
    `;

    this._sourcesEl = this.querySelector('.chart-sources');
    this._variableEl = this.querySelector('#chart-variable');
    this._variableWrapEl = this.querySelector('.chart-variable');
    this._statusEl = this.querySelector('#chart-status');
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

  // -- store ----------------------------------------------------------------

  _onStoreChange() {
    const { selection, teehrId } = store.get();

    // Only refetch when the selected feature actually changed; the store also fires for
    // theme and layer toggles, and refetching on those would hammer the endpoints.
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
    // Keep the selection key in step so the store notification this triggers is not
    // mistaken for a new feature.
    const { selection, teehrId } = store.get();
    this._lastSelectionKey = `${selection.type}:${selection.id}:${teehrId}`;
  }

  _variableForSource() {
    const s = store.get();
    if (this._source === 'teehr') return s.teehrVariable;
    if (this._source === 'troute') return s.trouteVariable;
    return s.variable;
  }

  // -- fetching -------------------------------------------------------------

  async load() {
    const { selection, modelRunId, trouteId, teehrId } = store.get();
    if (!selection.id) return;

    const seq = (this._requestSeq += 1);
    this._setBusy(true);
    this._setStatus('Loading…');

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
      this._setStatus(`Could not load data: ${error.message}`, 'error');
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

  // -- rendering ------------------------------------------------------------

  _renderPayload(payload) {
    // The TEEHR endpoints report "cannot answer" as a status message with a severity
    // rather than raising -- an unconfigured warehouse is a normal state, not an error.
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
    // Shapes differ: catchment returns {variables, variable}, troute returns
    // {troute_variables}, teehr returns {teehr_variables}.
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

    const dark = store.get().theme === 'dark';
    const stroke = dark ? '#e9ecef' : '#1b1b1b';
    const palette = dark
      ? ['#4dabf7', '#20c997', '#ffa94d']
      : ['#1f78b4', '#33a02c', '#e31a1c'];

    this._plot = new uPlot(
      {
        width: this._canvasEl.clientWidth || 600,
        height: this._canvasEl.clientHeight || 260,
        // uPlot's built-in cursor gives the hover readout the React version used a
        // separate @visx tooltip component for.
        cursor: { drag: { x: true, y: false } },
        axes: [
          { stroke, grid: { show: true, stroke: dark ? '#333' : '#eee' } },
          { stroke, label: layout?.yaxis || '', grid: { show: true, stroke: dark ? '#333' : '#eee' } },
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
  }

  _resizePlot() {
    if (!this._plot) return;
    this._plot.setSize({
      width: this._canvasEl.clientWidth || 600,
      height: this._canvasEl.clientHeight || 260,
    });
  }

  _destroyPlot() {
    if (this._plot) {
      this._plot.destroy();
      this._plot = null;
    }
  }

  // TEEHR skill scores, shown beside the plot. Columns are derived from the payload
  // because the configuration names are run-specific.
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

  // Disables the controls while a request is in flight, so a burst of clicks cannot queue
  // up requests whose responses arrive out of order.
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
