import { store } from './store/app-store.js';
import { syncDocumentTheme } from './lib/theme.js';

import './components/map/ngiab-map.js';
import './components/ngiab-chart.js';
import './components/ngiab-model-runs.js';
import './components/ngiab-legend.js';
import './components/ngiab-timeline.js';

syncDocumentTheme(store);
