import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import appAPI from '../../api/app.js';
import { getModelRunId } from '../../config.js';
import { store, actions } from '../../store/app-store.js';
import { toNumericIds, toCatchmentIndex } from '../../lib/ids.js';
import '../ngiab-search.js';
import {
  STYLE_URLS,
  SRC_DIVIDES,
  installLayers,
  refresh,
} from './layers.js';
import {
  attachHoverCursor,
  catchmentAtPoint,
  catchmentBounds,
  CatchmentNexusIndex,
} from './interactions.js';

// Global, not per-map: registering per render would re-register on every change.
maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);

export class NgiabMap extends HTMLElement {
  connectedCallback() {
    this._local = {
      catchmentIds: [],
      catchmentIndex: [],
      teehrNexusIds: [],
      teehrUsgsByNexus: new Map(),
    };
    this._nexusIndex = new CatchmentNexusIndex();
    this._loadedRunId = null;

    this._statusEl = document.getElementById('map-status');
    this._panelEl = document.getElementById('map-panel');
    this._panelIdEl = document.getElementById('map-panel-id');
    this._panelTeehrEl = document.getElementById('map-panel-teehr');
    this._panelNoteEl = document.getElementById('map-panel-note');
    this._chartPaneEl = document.getElementById('chart-pane');
    this._searchEl = document.querySelector('ngiab-search');

    // Seed from the URL so a shared link opens the right run.
    actions.setModelRun(getModelRunId() || null);

    this._createMap();
    this._bindControls();

    this._unsubscribe = store.subscribe(() => this._onStoreChange());
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    this._map?.remove();
  }

  get _view() {
    const state = store.get();
    return {
      theme: state.theme,
      catchmentHidden: state.layers.catchmentHidden,
      showTeehr: state.layers.showTeehr,
      selectedCatchmentId: state.selection.id,
      catchmentIds: this._local.catchmentIds,
      teehrNexusIds: this._local.teehrNexusIds,
    };
  }


  _createMap() {
    const map = new maplibregl.Map({
      container: 'map',
      style: STYLE_URLS[store.get().theme],
      center: [-96, 40],
      zoom: 4,
    });
    this._map = map;

    map.on('load', () => {
      installLayers(map, this._view);
      attachHoverCursor(map); // once only — see the note on the function
      this._syncModelRun();
    });

    map.on('click', (event) => this._handleClick(event));

    // 'idle' means tiles have settled, so this is when new divides join the nexus index.
    map.on('idle', () => this._nexusIndex.reindex(map));

    // setStyle() wipes our sources/layers; styledata can fire before the style is ready.
    map.on('styledata', () => {
      if (!map.isStyleLoaded()) return; // addSource throws while a style is loading
      if (map.getSource(SRC_DIVIDES)) return;
      installLayers(map, this._view);
      refresh(map, this._view);
    });

    // Surface tile/source failures rather than leaving a silently empty map.
    map.on('error', (event) => console.error('[map] maplibre error', event.error ?? event));
  }

  _onStoreChange() {
    const map = this._map;
    if (!map) return;

    refresh(map, this._view);
    if (map.isStyleLoaded()) this._syncModelRun();
    this._syncChartPane();
  }

  _syncChartPane() {
    if (!this._chartPaneEl) return;

    const shouldShow = Boolean(store.get().selection.id);
    if (this._chartPaneEl.hidden !== shouldShow) return; // already correct

    this._chartPaneEl.hidden = !shouldShow;
    // MapLibre does not observe container resizes, so tell it explicitly.
    this._map.resize();
  }


  _handleClick(event) {
    if (store.get().layers.catchmentHidden) return;

    const hit = catchmentAtPoint(this._map, event);
    if (!hit) return;

    // The gauge for a catchment is whichever one sits on its downstream `toid`.
    this._select({
      numeric: hit.numeric,
      label: this._labelFor(hit.numeric),
      nexusId: hit.nexusId,
      fly: false, // the user already clicked where they wanted to be
    });
  }

  _select({ numeric, label, nexusId, fly }) {
    const catchmentLabel = label ?? String(numeric);
    const teehrId =
      nexusId !== undefined
        ? (this._local.teehrUsgsByNexus.get(nexusId) ?? null)
        : this._lookupTeehrId(numeric);

    // troute wants the prefixed label ('cat-1015'), not the bare numeric tile id.
    actions.selectCatchment({
      id: numeric,
      label: catchmentLabel,
      trouteId: catchmentLabel,
      teehrId,
    });

    let located = true;
    if (fly) {
      const bounds = catchmentBounds(this._map, numeric);
      if (bounds) this._map.fitBounds(bounds, { padding: 80, duration: 800, maxZoom: 12 });
      else located = false;
    }

    this._reportSelection({ label: catchmentLabel, teehrId, located });
  }

  _labelFor(numeric) {
    return (
      this._local.catchmentIndex.find((entry) => entry.numeric === numeric)?.label ??
      String(numeric)
    );
  }

  _lookupTeehrId(numeric) {
    const nexusId = this._nexusIndex.nexusFor(numeric);
    return nexusId === undefined ? null : (this._local.teehrUsgsByNexus.get(nexusId) ?? null);
  }


  _syncModelRun() {
    const runId = store.get().modelRunId;
    if (runId === this._loadedRunId) return;
    this._loadedRunId = runId;

    if (!runId) {
      this._local.catchmentIds = [];
      this._local.catchmentIndex = [];
      this._local.teehrNexusIds = [];
      this._local.teehrUsgsByNexus = new Map();
      this._nexusIndex.clear();
      this._searchEl?.setIndex([], () => false);
      refresh(this._map, this._view);
      this._setStatus('No model run selected.', 'warning');
      return;
    }

    this._load(runId);
  }

  async _load(runId) {
    this._setStatus(`Loading ${runId}`, 'busy');

    const [geo, teehr] = await Promise.all([
      this._loadGeoSpatial(runId),
      this._loadTeehrLocations(runId).catch((error) => {
        console.warn('[map] TEEHR locations unavailable', error);
        return { count: 0, status: error.message };
      }),
    ]).catch((error) => {
      console.error('[map] geospatial fetch failed', error);
      this._setStatus(`Could not load this model run: ${error.message}`, 'error');
      return [null, null];
    });

    if (!geo) return;

    refresh(this._map, this._view); // paint the TEEHR colours once both halves have landed
    this._searchEl?.setIndex(this._local.catchmentIndex, (n) => this._lookupTeehrId(n) != null);

    // Say this out loud: an empty run looks identical to a broken map otherwise.
    if (!geo.catchments) {
      this._setStatus('This model run has no catchment outputs, so nothing is drawn.', 'warning');
      return;
    }

    const parts = [`${geo.catchments} catchments`];
    if (geo.dropped) parts.push(`${geo.dropped} unparseable ids dropped`);
    parts.push(teehr?.count ? `${teehr.count} TEEHR nexus` : (teehr?.status ?? 'no TEEHR'));
    this._setStatus(parts.join(' · '));
  }

  async _loadGeoSpatial(runId) {
    // getJSON raises on a bad status and on the HTTP-200-plus-error-key shape.
    const body = await appAPI.getGeoSpatialData({ model_run_id: runId });

    const catchments = Array.isArray(body.catchments) ? body.catchments : [];
    this._local.catchmentIndex = toCatchmentIndex(catchments);
    this._local.catchmentIds = this._local.catchmentIndex.map((entry) => entry.numeric);
    actions.clearSelection();

    refresh(this._map, this._view);

    // bounds is a flat [west, south, east, north] from gdf.total_bounds.tolist().
    if (body.bounds) this._map.fitBounds(body.bounds, { padding: 20, duration: 1000 });

    const dropped = catchments.length - this._local.catchmentIds.length;
    return { catchments: this._local.catchmentIds.length, dropped: Math.max(dropped, 0) };
  }

  async _loadTeehrLocations(runId) {
    const body = await appAPI.getTeehrLocations({ model_run_id: runId });
    const locations = body.teehr_locations ?? [];

    this._local.teehrUsgsByNexus = new Map();
    for (const { nexus_id: nexusId, usgs_id: usgsId } of locations) {
      const [numeric] = toNumericIds([nexusId]);
      if (numeric !== undefined) this._local.teehrUsgsByNexus.set(numeric, usgsId);
    }
    this._local.teehrNexusIds = [...this._local.teehrUsgsByNexus.keys()];

    return { count: this._local.teehrNexusIds.length, status: body.teehr_status };
  }


  _setStatus(message, severity = null) {
    if (!this._statusEl) return;
    this._statusEl.textContent = message;
    this._statusEl.dataset.severity = message && severity ? severity : '';
    this._statusEl.classList.toggle('is-busy', severity === 'busy');
  }

  _reportSelection({ label, teehrId, located }) {
    if (!this._panelEl) return;

    this._panelEl.hidden = false;
    this._panelIdEl.textContent = label;
    this._panelTeehrEl.textContent = teehrId
      ? `TEEHR · ${teehrId}`
      : 'No TEEHR results for this catchment';

    const missing = located === false;
    this._panelNoteEl.hidden = !missing;
    if (missing) {
      this._panelNoteEl.textContent =
        'Geometry not in the loaded tiles yet — it will highlight once you pan or zoom to it.';
    }
  }

  _bindControls() {
    const bind = (id, handler) => {
      document
        .getElementById(id)
        ?.addEventListener('change', (event) => handler(event.target.checked));
    };

    bind('toggle-theme', (on) => {
      actions.setTheme(on ? 'dark' : 'light');
      // The styledata handler reinstalls the layers once the new style is ready.
      this._map.setStyle(STYLE_URLS[on ? 'dark' : 'light']);
    });
    bind('toggle-catchments', (hidden) => actions.setLayer('catchmentHidden', hidden));
    bind('toggle-teehr', (show) => actions.setLayer('showTeehr', show));

    this._searchEl?.addEventListener('catchment-selected', (event) => {
      const { numeric, label } = event.detail;
      this._select({ numeric, label, fly: true });
    });
  }
}

customElements.define('ngiab-map', NgiabMap);
