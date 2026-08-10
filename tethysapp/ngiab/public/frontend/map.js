/**
 * Entry point for the map page.
 *
 * Registers the custom elements the template instantiates; all behaviour lives in the
 * components. This file was 793 lines doing seven jobs before the split — see
 * components/map/ for layers (pure, unit-tested), interactions (needs a live map), and the
 * <ngiab-map> element that orchestrates them.
 */

import './components/map/ngiab-map.js';
import './components/ngiab-chart.js';
import './components/ngiab-model-runs.js';
