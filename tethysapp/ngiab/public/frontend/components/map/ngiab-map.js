import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import appAPI from '../../api/app.js';
import {
  canUpload,
  getModelRunId,
  terrainUrl,
  terrainExaggeration,
  terrainExaggeration3D,
  terrainTileSize,
} from '../../config.js';
import { noRunsMessage } from '../../lib/empty-runs.js';
import { store, actions } from '../../store/app-store.js';
import { toNumericIds, toCatchmentIndex } from '../../lib/ids.js';
import '../ngiab-search.js';
import {
  STYLE_URLS,
  SRC_DIVIDES,
  catchmentsExtruded,
  installLayers,
  refresh,
} from './layers.js';
import { applyTerrain, removeTerrain } from './terrain.js';
import { applyPitch, pitchFor, PITCH_FLAT } from './camera.js';
import {
  attachHoverCursor,
  attachMapTip,
  catchmentAtPoint,
  catchmentBounds,
  CatchmentNexusIndex,
} from './interactions.js';
import { ChoroplethState } from './choropleth-layer.js';
import { legendEntries, legendLabel } from '../../lib/choropleth.js';
import { userMessage } from '../../lib/errors.js';

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);

const SKY_PAINT = {
  light: {
    'sky-color': '#8fbce6',
    'sky-horizon-blend': 0.5,
    'horizon-color': '#e8f0f7',
    'horizon-fog-blend': 0.6,
    'fog-color': '#dfe6ec',
    'fog-ground-blend': 0.5,
  },
  dark: {
    'sky-color': '#0b1a2e',
    'sky-horizon-blend': 0.5,
    'horizon-color': '#243244',
    'horizon-fog-blend': 0.6,
    'fog-color': '#111a24',
    'fog-ground-blend': 0.5,
  },
};

export class NgiabMap extends HTMLElement {
  connectedCallback() {
    this._local = {
      catchmentIds: [],
      catchmentIndex: [],
      teehrNexusIds: [],
      teehrUsgsByNexus: new Map(),
    };
    this._nexusIndex = new CatchmentNexusIndex();

    this._loadedRunId = undefined;

    this._statusEl = document.getElementById('map-status');
    this._panelEl = document.getElementById('map-panel');
    this._panelIdEl = document.getElementById('map-panel-id');
    this._panelTeehrEl = document.getElementById('map-panel-teehr');
    this._panelNoteEl = document.getElementById('map-panel-note');
    this._chartPaneEl = document.getElementById('chart-pane');
    this._searchEl = document.querySelector('ngiab-search');
    this._legendEl = document.querySelector('ngiab-legend');
    this._timelineEl = document.querySelector('ngiab-timeline');
    this._mapVariableEl = document.getElementById('map-variable');
    this._emptyEl = document.getElementById('map-empty');
    this._emptyTitleEl = document.getElementById('map-empty-title');
    this._emptyBodyEl = document.getElementById('map-empty-body');
    this._resetViewEl = document.getElementById('map-reset-view');
    this._searchInputEl = document.getElementById('map-search');
    this._loadedVariableKey = null;

    actions.setModelRun(getModelRunId() || null);

    this._createMap();
    this._bindControls();

    this._unsubscribe = store.subscribe(() => this._onStoreChange());

    this._onPaneResize = () => this._map?.resize();
    window.addEventListener('ngiab-pane-resize', this._onPaneResize);
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    window.removeEventListener('ngiab-pane-resize', this._onPaneResize);
    this._map?.remove();
  }

  get _view() {
    const state = store.get();
    return {
      theme: state.theme,
      catchmentHidden: state.layers.catchmentHidden,
      showTeehr: state.layers.showTeehr,
      extrude: state.layers.extrude,
      terrain: state.layers.terrain,
      selectedCatchmentId: state.selection.id,
      catchmentIds: this._local.catchmentIds,
      teehrNexusIds: this._local.teehrNexusIds,
      choropleth: Boolean(state.mapVariable) && Boolean(this._choropleth?.isLoaded),
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
    this._appliedPitch = PITCH_FLAT;
    this._pitchState = { deferred: false, pitch: PITCH_FLAT };
    this._appliedTerrain = false;
    this._appliedExaggeration = null;
    this._appliedSkyTheme = null;
    this._choropleth = new ChoroplethState(map);

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

    map.on('load', () => {
      installLayers(map, this._view);
      attachHoverCursor(map);
      attachMapTip(map, (numeric) => this._describeCatchment(numeric));
      this._syncModelRun();
    });

    map.on('click', (event) => this._handleClick(event));

    map.on('idle', () => {
      this._ensureLayers();
      this._nexusIndex.reindex(map);
      this._choropleth.reapply();
      this._syncTerrain(this._view);
      this._applySky();

      this._syncModelRun();
    });

    map.on('styledata', () => this._ensureLayers());

    map.on('error', (event) => console.error('[map] maplibre error', event.error ?? event));
  }

  _ensureLayers() {
    const map = this._map;
    if (!map?.isStyleLoaded()) return;
    if (map.getSource(SRC_DIVIDES)) return;
    const view = this._view;
    installLayers(map, view);
    this._markViewApplied(view);
    refresh(map, view);
    this._syncTerrain(view, { force: true });
  }

  _syncPitch(view) {
    const pitch = pitchFor(view);
    if (pitch === this._appliedPitch) return;
    this._appliedPitch = pitch;
    applyPitch(this._map, pitch, this._pitchState);
  }

  _applySky() {
    const theme = store.get().theme;
    if (theme === this._appliedSkyTheme) return;
    this._appliedSkyTheme = theme;
    this._map?.setSky(theme === 'dark' ? SKY_PAINT.dark : SKY_PAINT.light);
  }

  _syncTerrain(view, { force = false } = {}) {
    if (!view.terrain) {
      this._appliedTerrain = false;
      this._appliedExaggeration = null;
      removeTerrain(this._map);
      return;
    }
    const exaggeration = catchmentsExtruded(view)
      ? terrainExaggeration3D()
      : terrainExaggeration();
    if (!force && this._appliedTerrain && exaggeration === this._appliedExaggeration) return;
    if (!this._map?.isStyleLoaded()) return;
    this._appliedTerrain = true;
    this._appliedExaggeration = exaggeration;
    applyTerrain(this._map, {
      url: terrainUrl(),
      exaggeration,
      tileSize: terrainTileSize(),
      dark: view.theme === 'dark',
    });
  }

  _applyView(view = this._view) {
    this._markViewApplied(view);
    refresh(this._map, view);
    this._syncPitch(view);
    this._syncTerrain(view);
  }

  _viewKey(view) {
    return `${view.theme}|${view.catchmentHidden}|${view.showTeehr}|${view.extrude}|`
      + `${view.terrain}|${view.selectedCatchmentId}|${view.choropleth}`;
  }

  _markViewApplied(view) {
    this._appliedScalarKey = this._viewKey(view);
    this._appliedCatchmentIds = view.catchmentIds;
    this._appliedTeehrIds = view.teehrNexusIds;
  }

  _viewChanged(view) {
    return this._viewKey(view) !== this._appliedScalarKey
      || view.catchmentIds !== this._appliedCatchmentIds
      || view.teehrNexusIds !== this._appliedTeehrIds;
  }

  _onStoreChange() {
    const map = this._map;
    if (!map) return;

    const view = this._view;
    if (this._viewChanged(view)) this._applyView(view);
    if (map.isStyleLoaded()) this._syncModelRun();
    this._syncMapVariable();
    this._syncFrame();
    this._syncChartPane();
  }

  _syncMapVariable() {
    const { modelRunId, mapVariable } = store.get();
    const key = `${modelRunId}::${mapVariable ?? ''}`;
    if (key === this._loadedVariableKey) return;
    this._loadedVariableKey = key;

    if (!modelRunId || !mapVariable) {
      this._choropleth.clear();
      this._timelineEl?.setTimes([]);
      this._legendEl?.setScale({ variable: null, breaks: [] });
      this._applyView();
      return;
    }

    this._loadMatrix(modelRunId, mapVariable);
  }

  async _loadMatrix(runId, variable) {
    this._setStatus(`Loading ${variable}`, 'busy');
    try {
      const matrix = await appAPI.getCatchmentValueMatrix({
        model_run_id: runId,
        variable,
      });

      if (this._loadedVariableKey !== `${runId}::${variable}`) return;

      this._choropleth.load(matrix);
      this._timelineEl?.setTimes(matrix.times);
      this._legendEl?.setScale({ variable: matrix.variable, breaks: matrix.breaks });

      this._applyView();
      this._syncFrame(true);

      const step = matrix.step_hours ? ` · ${matrix.step_hours}h steps` : '';
      this._setStatus(`${matrix.variable} · ${matrix.times.length} frames${step}`);
    } catch (error) {
      console.error('[map] value matrix failed', error);
      this._choropleth.clear();
      this._timelineEl?.setTimes([]);
      this._setStatus(`Could not shade by ${variable}. ${userMessage(error)}`, 'error');
    }
  }

  _syncFrame(force = false) {
    if (!this._choropleth?.isLoaded) return;
    const { frameIndex } = store.get();
    if (!force && frameIndex === this._shownFrame) return;
    this._shownFrame = frameIndex;
    this._choropleth.show(frameIndex);
  }

  _syncChartPane() {
    if (!this._chartPaneEl) return;

    const shouldShow = Boolean(store.get().selection.id);
    if (this._chartPaneEl.hidden !== shouldShow) return;

    this._chartPaneEl.hidden = !shouldShow;
    this._map.resize();
  }


  _handleClick(event) {
    if (store.get().layers.catchmentHidden) return;

    const hit = catchmentAtPoint(this._map, event);
    if (!hit) return;

    this._select({
      numeric: hit.numeric,
      label: this._labelFor(hit.numeric),
      nexusId: hit.nexusId,
      fly: false,
    });
  }

  _select({ numeric, label, nexusId, fly }) {
    const catchmentLabel = label ?? String(numeric);
    const teehrId =
      nexusId !== undefined
        ? (this._local.teehrUsgsByNexus.get(nexusId) ?? null)
        : this._lookupTeehrId(numeric);

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

  _describeCatchment(numeric) {
    if (!this._local.catchmentIds.includes(numeric)) return '';

    const rows = [`<strong>${escapeHtml(this._labelFor(numeric))}</strong>`];

    const teehrId = this._lookupTeehrId(numeric);
    if (teehrId) rows.push(`<span class="tip-teehr">TEEHR · ${escapeHtml(teehrId)}</span>`);

    const { mapVariable, frameIndex } = store.get();
    if (mapVariable && this._choropleth.isLoaded) {
      const bin = this._choropleth.binAt(numeric, frameIndex);
      const entry = legendEntries(this._choropleth.breaks, store.get().theme)[bin - 1];
      const value = bin && entry ? legendLabel(entry) : 'no value at this timestep';
      rows.push(`<span class="tip-value">${escapeHtml(mapVariable)}: ${escapeHtml(value)}</span>`);
    }

    return rows.join('<br />');
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
      this._local.bounds = null;
      this._nexusIndex.clear();
      this._choropleth.clear();
      this._searchEl?.setIndex([], () => false);
      this._timelineEl?.setTimes([]);
      refresh(this._map, this._view);
      this._setEmptyState('No model run to show', noRunsMessage(canUpload()));
      this._setStatus('No model run selected.', 'warning');
      return;
    }

    this._loadVariables(runId);
    this._load(runId);
  }

  async _load(runId) {
    this._setStatus(`Loading ${runId}`, 'busy');

    const [geo, teehr] = await Promise.all([
      this._loadGeoSpatial(runId),
      this._loadTeehrLocations(runId).catch((error) => {
        console.warn('[map] TEEHR locations unavailable', error);
        return { count: 0, status: userMessage(error) };
      }),
    ]).catch((error) => {
      console.error('[map] geospatial fetch failed', error);
      this._setStatus(`Could not load this model run. ${userMessage(error)}`, 'error');
      return [null, null];
    });

    if (!geo) return;

    refresh(this._map, this._view);
    this._searchEl?.setIndex(this._local.catchmentIndex, (n) => this._lookupTeehrId(n) != null);
    this._legendEl?.setTeehrCount(teehr?.count ?? 0);

    if (!geo.catchments) {
      this._setEmptyState(
        'Nothing to draw for this model run',
        'Its outputs/ngen directory has no catchment files, so the map is empty rather than ' +
          'broken. Pick a different run, or check that the run finished writing.',
      );
      this._setStatus('This model run has no catchment outputs, so nothing is drawn.', 'warning');
      return;
    }
    this._setEmptyState(null);

    const parts = [`${geo.catchments} catchments`];
    if (geo.dropped) parts.push(`${geo.dropped} unparseable ids dropped`);
    parts.push(teehr?.count ? `${teehr.count} TEEHR nexus` : (teehr?.status ?? 'no TEEHR'));
    this._setStatus(parts.join(' · '));
  }

  async _loadGeoSpatial(runId) {
    const body = await appAPI.getGeoSpatialData({ model_run_id: runId });

    const catchments = Array.isArray(body.catchments) ? body.catchments : [];
    this._local.catchmentIndex = toCatchmentIndex(catchments);
    this._local.catchmentIds = this._local.catchmentIndex.map((entry) => entry.numeric);
    actions.clearSelection();

    refresh(this._map, this._view);

    this._local.bounds = body.bounds ?? null;
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


  _setEmptyState(title, body = '') {
    if (!this._emptyEl) return;
    this._emptyEl.hidden = !title;
    if (title) {
      this._emptyTitleEl.textContent = title;
      this._emptyBodyEl.textContent = body;
    }

    const usable = !title;
    if (this._searchInputEl) this._searchInputEl.disabled = !usable;
    if (this._resetViewEl) this._resetViewEl.disabled = !usable;
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
        'Geometry not in the loaded tiles yet. It will highlight once you pan or zoom to it.';
    }
  }

  _bindControls() {
    const bind = (id, handler) => {
      const el = document.getElementById(id);
      el?.addEventListener('change', (event) => handler(event.target.checked));
      return el;
    };

    bind('toggle-theme', (on) => {
      actions.setTheme(on ? 'dark' : 'light');
      this._appliedTerrain = false;
      this._appliedExaggeration = null;
      this._appliedSkyTheme = null;
      this._map.setStyle(STYLE_URLS[on ? 'dark' : 'light']);
    });
    bind('toggle-catchments', (shown) => actions.setLayer('catchmentHidden', !shown));
    bind('toggle-teehr', (show) => actions.setLayer('showTeehr', show));
    bind('toggle-3d', (on) => actions.setLayer('extrude', on));
    const terrainToggle = bind('toggle-terrain', (on) => actions.setLayer('terrain', on));

    if (!terrainUrl() && terrainToggle) {
      terrainToggle.disabled = true;
      terrainToggle.closest('.toggle')?.setAttribute('title', 'Terrain tiles are not configured');
    }

    this._mapVariableEl?.addEventListener('change', (event) => {
      actions.setMapVariable(event.target.value || null);
    });

    document.getElementById('map-reset-view')?.addEventListener('click', () => {
      this._fitRunExtent();
    });

    this._searchEl?.addEventListener('catchment-selected', (event) => {
      const { numeric, label } = event.detail;
      this._select({ numeric, label, fly: true });
    });
  }

  _fitRunExtent() {
    if (this._local.bounds) this._map.fitBounds(this._local.bounds, { padding: 20, duration: 800 });
  }

  async _loadVariables(runId) {
    if (!this._mapVariableEl) return;
    try {
      const body = await appAPI.getCatchmentVariables({ model_run_id: runId });
      const names = body.variables ?? [];
      this._mapVariableEl.replaceChildren(new Option('no shading', ''));
      for (const name of names) this._mapVariableEl.add(new Option(name, name));
      this._mapVariableEl.disabled = !names.length;
    } catch (error) {
      console.warn('[map] variable list unavailable', error);
      this._mapVariableEl.replaceChildren(new Option('no shading', ''));
      this._mapVariableEl.disabled = true;
    }
  }
}

customElements.define('ngiab-map', NgiabMap);
