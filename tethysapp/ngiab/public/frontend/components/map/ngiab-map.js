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

// pmtiles protocol registration is global, not per-map. The React version did this inside a
// useEffect keyed on [theme, model run], so it re-registered on every change.
maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);

/**
 * `<ngiab-map>` — the hydrofabric map and its controls.
 *
 * Owns the MapLibre instance and the run's geometry. Shared state (theme, selection, layer
 * flags) lives in the global store so the chart reacts to the same selection; only
 * tile-derived caches — the search index and the catchment → nexus map — stay local, since
 * nothing else reads them and they churn on every pan.
 */
export class NgiabMap extends HTMLElement {
  connectedCallback() {
    /** Run-scoped data the layers filter on. */
    this._local = {
      catchmentIds: [],
      catchmentIndex: [],
      teehrNexusIds: [],
      teehrUsgsByNexus: new Map(),
    };
    this._nexusIndex = new CatchmentNexusIndex();
    /** Which run's geometry is currently drawn, so a change reloads exactly once. */
    this._loadedRunId = null;

    this._statusEl = document.getElementById('map-status');
    this._panelEl = document.getElementById('map-panel');
    this._panelIdEl = document.getElementById('map-panel-id');
    this._panelTeehrEl = document.getElementById('map-panel-teehr');
    this._panelNoteEl = document.getElementById('map-panel-note');
    this._chartPaneEl = document.getElementById('chart-pane');
    this._searchEl = document.querySelector('ngiab-search');

    // Seed from the URL so a shared link opens the right run; <ngiab-model-runs> takes over.
    actions.setModelRun(getModelRunId() || null);

    this._createMap();
    this._bindControls();

    this._unsubscribe = store.subscribe(() => this._onStoreChange());
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    this._map?.remove();
  }

  /** The explicit view object layers.js renders from. */
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

  // -- map lifecycle --------------------------------------------------------

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

    // 'idle' fires once tile loading and rendering settle: where newly arrived divide tiles
    // get folded into the catchment → nexus index.
    map.on('idle', () => this._nexusIndex.reindex(map));

    // setStyle() wipes every custom source and layer. Reinstalling on `once('styledata')` is
    // not enough — styledata fires several times per swap and the first can arrive before
    // the style is ready, so the layers get added and then thrown away. Watching every
    // styledata and reinstalling when the source has gone missing is self-healing.
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

  /** Show the chart pane only while something is selected, resizing the map to match. */
  _syncChartPane() {
    if (!this._chartPaneEl) return;

    const shouldShow = Boolean(store.get().selection.id);
    if (this._chartPaneEl.hidden !== shouldShow) return; // already correct

    this._chartPaneEl.hidden = !shouldShow;
    // The map container's height just changed and MapLibre does not observe that on its
    // own; without this the canvas keeps its old dimensions and the map looks stretched.
    this._map.resize();
  }

  // -- selection ------------------------------------------------------------

  _handleClick(event) {
    if (store.get().layers.catchmentHidden) return;

    const hit = catchmentAtPoint(this._map, event);
    if (!hit) return;

    // Geometry joins to TEEHR through its downstream nexus, so the gauge for a clicked
    // catchment is whichever gauge sits on its `toid`.
    this._select({
      numeric: hit.numeric,
      label: this._labelFor(hit.numeric),
      nexusId: hit.nexusId,
      fly: false, // the user already clicked where they wanted to be
    });
  }

  /**
   * Single entry point for "this catchment is now selected", shared by the map click and the
   * search bar so the two cannot drift.
   */
  _select({ numeric, label, nexusId, fly }) {
    const catchmentLabel = label ?? String(numeric);
    const teehrId =
      nexusId !== undefined
        ? (this._local.teehrUsgsByNexus.get(nexusId) ?? null)
        : this._lookupTeehrId(numeric);

    // The store owns the selection; the subscription repaints the highlight. The troute
    // endpoint wants the prefixed label ("cat-1015"), not the bare numeric tile id.
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

  /** The tiles carry only numbers; the run's payload has the "cat-N" labels. */
  _labelFor(numeric) {
    return (
      this._local.catchmentIndex.find((entry) => entry.numeric === numeric)?.label ??
      String(numeric)
    );
  }

  /**
   * null means "no TEEHR gauge, OR this catchment's tile has not loaded yet" — the two are
   * not distinguishable client-side, which is why the search badge is positive-only.
   */
  _lookupTeehrId(numeric) {
    const nexusId = this._nexusIndex.nexusFor(numeric);
    return nexusId === undefined ? null : (this._local.teehrUsgsByNexus.get(nexusId) ?? null);
  }

  // -- data -----------------------------------------------------------------

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

  /**
   * Geometry is required; TEEHR colouring is not. Both are fetched together and the TEEHR
   * half fails soft, so an unconfigured or broken warehouse still yields a working map.
   *
   * @param {string} runId
   */
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

    // A run with no catchment outputs renders an empty map, indistinguishable from a broken
    // one unless it is said out loud.
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
    // getJSON raises on a non-ok status AND on the HTTP-200-plus-error-key shape several
    // controllers use, so both failure modes arrive as exceptions.
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

  /**
   * Which nexuses have TEEHR results for this run. Deliberately NOT derived from the nexus
   * payload's ngen_usgs column: that reflects the warehouse-wide crosswalk with no
   * configuration filter, so it reports gauges this run never evaluated.
   */
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

  // -- chrome ---------------------------------------------------------------

  /** severity mirrors the backend's vocabulary so a missing warehouse is not styled as a failure. */
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
