# Vanilla-JS Migration — Phase 0 (Build-less Scaffold) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a build-less, vanilla-JS frontend pipeline for the NGIAB app — served by Tethys with no bundler — proving native ES modules + import map + a store + the ported API layer + one rendering custom element all work end-to-end.

**Architecture:** The app is authored directly under `tethysapp/ngiab/public/app/` (source == served static files; no webpack/Vite). The browser loads `main.js` as a module; bare imports (e.g. `axios`) resolve via an import map declared in the Django template using absolute `{% static %}` URLs. Runtime config (app root URL) is injected by the template into `window.__NGIAB__`. State lives in one tiny observable store; UI is native custom elements rendering into light DOM.

**Tech Stack:** Vanilla JS (ES modules), native Web Components, vendored ESM deps (axios in this phase), `@web/test-runner` for tests. Backend unchanged (Tethys/Django).

## Global Constraints

- **No build step.** No bundler, transpiler, or JSX/TS. Plain ES modules run as-authored in the browser.
- **App is served from** `tethysapp/ngiab/public/app/` → static URL prefix `/static/ngiab/app/`.
- **Never author into `tethysapp/ngiab/public/frontend/`** — that is webpack's output path for the
  legacy React app (`reactapp/config/webpack.config.js:15`) and stays gitignored until Phase 2
  deletes it. Keeping the two dirs separate is what stops rebuilds from clobbering source.
- **Dependencies are vendored** as local ESM under `.../app/vendor/`; referenced via the template import map. No CDN.
- **Import-map paths must be absolute** (via `{% static %}`) — import maps resolve relative specifiers against the document base (`/apps/ngiab/`), not the script location.
- **Web Components render into light DOM** (no shadow DOM) so global CSS applies.
- **Single global store**; components subscribe in `connectedCallback`, unsubscribe in `disconnectedCallback`.
- **DataStream is removed** — do not port any datastream endpoint or view.
- **Commit messages: no AI/Claude attribution** (no `Co-Authored-By: Claude`, no "Generated with" footer).
- Work on branch `feature/vanilla-js-migration`.

---

### Task 1: Create the skeleton dir — DONE (with correction)

Originally this task un-ignored `tethysapp/ngiab/public/frontend/` and authored the skeleton there.
That was wrong: `frontend/` is webpack's output path for the React app, so commit `40ec559` swept
build artifacts (`main.js`, `595.js`, `958.js`, two hashed PNGs, LICENSE files) into git as tracked
source, and any `npm run build` would have overwritten hand-authored files. Corrected by moving the
skeleton to `tethysapp/ngiab/public/app/`, restoring the `frontend/` gitignore entry, and untracking
the artifacts.

**Files:**
- Modify: `.gitignore` (restore the `tethysapp/ngiab/public/frontend/` ignore)
- Create: `tethysapp/ngiab/public/app/README.md`
- Create: `tethysapp/ngiab/public/app/src/styles/tokens.css`
- Create: `tethysapp/ngiab/public/app/src/styles/app.css`
- Untrack: the seven webpack artifacts under `tethysapp/ngiab/public/frontend/` (files stay on disk)

**Interfaces:**
- Produces: the served directory `tethysapp/ngiab/public/app/` (static prefix `/static/ngiab/app/`) and two stylesheets referenced by the template in Task 8.

- [x] **Step 1: Keep `frontend/` ignored, author under `app/`**

`.gitignore` retains `tethysapp/ngiab/public/frontend/`. The new source dir `public/app/` is tracked.

- [x] **Step 2: Create the README marker**

`tethysapp/ngiab/public/app/README.md`:
```markdown
# NGIAB frontend (build-less)

Vanilla JS + native Web Components. No bundler. These files are served as-is by Tethys at
`/static/ngiab/app/`. Dependencies are vendored as ESM under `vendor/` and wired via the
import map in `tethysapp/ngiab/templates/ngiab/index.html`.

Source lives here directly — there is no build output. The sibling `../frontend/` directory is
webpack output for the legacy React app and stays gitignored until the Phase 2 cutover deletes it.
```

- [x] **Step 3: Create `tokens.css`**

`tethysapp/ngiab/public/app/src/styles/tokens.css`:
```css
:root {
  --bg: #ffffff;
  --fg: #1b1b1b;
  --accent: #1f78b4;
}
:root[data-theme="dark"] {
  --bg: #1b1f24;
  --fg: #e9ecef;
  --accent: #4f9fd6;
}
```

- [x] **Step 4: Create `app.css`**

`tethysapp/ngiab/public/app/src/styles/app.css`:
```css
html, body { height: 100%; }
body { background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; }
.app-header { padding: 0.5rem 1rem; font-weight: 600; border-bottom: 1px solid var(--accent); }
.app-main { padding: 1rem; }
```

- [x] **Step 5: Commit**

Initial (flawed) scaffold: `40ec559`. Correction commit relocates it to `public/app/`, restores the
`frontend/` gitignore entry, untracks the webpack artifacts, and updates the spec + this plan.

---

### Task 2: Vendor axios as ESM

**Files:**
- Create: `tethysapp/ngiab/public/app/vendor/axios.esm.js` (copied from node_modules)
- Create: `tethysapp/ngiab/public/app/vendor/VERSIONS.md`

**Interfaces:**
- Produces: a local ESM axios importable via the bare specifier `axios` (wired in Task 5's client and Task 8's import map / Task 9's test config).

- [ ] **Step 1: Copy the axios ESM build from node_modules**

Run:
```bash
cp node_modules/axios/dist/esm/axios.min.js tethysapp/ngiab/public/app/vendor/axios.esm.js
```
Expected: file exists, non-empty (`test -s tethysapp/ngiab/public/app/vendor/axios.esm.js && echo OK`).

- [ ] **Step 2: Record the version**

Read the installed version: `node -e "console.log(require('axios/package.json').version)"`.
Create `tethysapp/ngiab/public/app/vendor/VERSIONS.md` with that value:
```markdown
# Vendored ESM versions
- axios: <paste version here> (from node_modules/axios/dist/esm/axios.min.js)
```

- [ ] **Step 3: Commit**

```bash
git add tethysapp/ngiab/public/app/vendor/
git commit -m "chore: vendor axios ESM"
```

---

### Task 3: Runtime config module

**Files:**
- Create: `tethysapp/ngiab/public/app/src/config.js`
- Test: `tethysapp/ngiab/public/app/src/config.test.js`

**Interfaces:**
- Produces: `getConfig() -> { APP_ROOT_URL: string, PORTAL_HOST: string }`, reading `window.__NGIAB__` with sane defaults. Consumed by Task 5 (API layer).

- [ ] **Step 1: Write the failing test**

`tethysapp/ngiab/public/app/src/config.test.js`:
```js
import { expect } from '@esm-bundle/chai';
import { getConfig } from './config.js';

it('defaults when window.__NGIAB__ is absent', () => {
  delete window.__NGIAB__;
  expect(getConfig().APP_ROOT_URL).to.equal('/apps/ngiab/');
  expect(getConfig().PORTAL_HOST).to.equal('');
});

it('reads injected values', () => {
  window.__NGIAB__ = { APP_ROOT_URL: '/portal/apps/ngiab/', PORTAL_HOST: 'https://h' };
  expect(getConfig().APP_ROOT_URL).to.equal('/portal/apps/ngiab/');
  expect(getConfig().PORTAL_HOST).to.equal('https://h');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx web-test-runner "tethysapp/ngiab/public/app/src/config.test.js" --node-resolve`
Expected: FAIL — cannot resolve `./config.js` (module not found).

- [ ] **Step 3: Write minimal implementation**

`tethysapp/ngiab/public/app/src/config.js`:
```js
// Runtime config injected by the Django template into window.__NGIAB__.
export function getConfig() {
  const cfg = (typeof window !== 'undefined' && window.__NGIAB__) || {};
  return {
    APP_ROOT_URL: cfg.APP_ROOT_URL || '/apps/ngiab/',
    PORTAL_HOST: cfg.PORTAL_HOST || '',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx web-test-runner "tethysapp/ngiab/public/app/src/config.test.js" --node-resolve`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add tethysapp/ngiab/public/app/src/config.js tethysapp/ngiab/public/app/src/config.test.js
git commit -m "feat: runtime config module reading window.__NGIAB__"
```

---

### Task 4: The observable store

**Files:**
- Create: `tethysapp/ngiab/public/app/src/store/store.js`
- Test: `tethysapp/ngiab/public/app/src/store/store.test.js`

**Interfaces:**
- Produces: `createStore(initialState) -> { get(): State, set(patch): void, subscribe(fn): () => void }`. Consumed by Task 6 (app-store singleton) and all components.

- [ ] **Step 1: Write the failing test**

`tethysapp/ngiab/public/app/src/store/store.test.js`:
```js
import { expect } from '@esm-bundle/chai';
import { createStore } from './store.js';

it('returns initial state from get()', () => {
  const s = createStore({ a: 1 });
  expect(s.get()).to.deep.equal({ a: 1 });
});

it('set() merges a patch and notifies subscribers', () => {
  const s = createStore({ a: 1, b: 2 });
  let seen = null;
  s.subscribe((state) => { seen = state; });
  s.set({ b: 3 });
  expect(s.get()).to.deep.equal({ a: 1, b: 3 });
  expect(seen).to.deep.equal({ a: 1, b: 3 });
});

it('subscribe() returns an unsubscribe that stops notifications', () => {
  const s = createStore({ a: 1 });
  let calls = 0;
  const off = s.subscribe(() => { calls += 1; });
  s.set({ a: 2 });
  off();
  s.set({ a: 3 });
  expect(calls).to.equal(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx web-test-runner "tethysapp/ngiab/public/app/src/store/store.test.js" --node-resolve`
Expected: FAIL — `./store.js` not found.

- [ ] **Step 3: Write minimal implementation**

`tethysapp/ngiab/public/app/src/store/store.js`:
```js
// Minimal observable store: get / set (shallow merge) / subscribe.
export function createStore(initialState) {
  let state = { ...initialState };
  const subscribers = new Set();
  return {
    get() { return state; },
    set(patch) {
      state = { ...state, ...patch };
      subscribers.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx web-test-runner "tethysapp/ngiab/public/app/src/store/store.test.js" --node-resolve`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add tethysapp/ngiab/public/app/src/store/
git commit -m "feat: minimal observable store"
```

---

### Task 5: Port the API layer (DataStream removed)

**Files:**
- Create: `tethysapp/ngiab/public/app/src/api/utilities.js`
- Create: `tethysapp/ngiab/public/app/src/api/tethys.js`
- Create: `tethysapp/ngiab/public/app/src/api/client.js`
- Create: `tethysapp/ngiab/public/app/src/api/app.js`
- Test: `tethysapp/ngiab/public/app/src/api/app.test.js`

**Interfaces:**
- Consumes: `getConfig()` from Task 3; `axios` (vendored, Task 2).
- Produces: `appAPI` default export with methods `getModelRuns`, `getGeoSpatialData(params)`, `getNexusTimeSeries(params)`, `getCatchmentTimeSeries(params)`, `getTrouteVariables(params)`, `getTrouteTimeSeries(params)`, `getTeehrTimeSeries(params)`, `getTeehrVariables(params)`. Consumed by Phase 1 components.

- [ ] **Step 1: Port `utilities.js`**

`tethysapp/ngiab/public/app/src/api/utilities.js`:
```js
import { getConfig } from '../config.js';

// Portal host: injected config, else the current origin.
export function getTethysPortalHost() {
  const host = getConfig().PORTAL_HOST;
  if (host && host.length) return host;
  return new URL(window.location.href).origin;
}
```

- [ ] **Step 2: Port `tethys.js`**

Copy `reactapp/services/api/tethys.js` verbatim into `tethysapp/ngiab/public/app/src/api/tethys.js`, fixing import paths to be relative (`./client.js`, `../config.js`) if it imports anything. If the original has no imports, copy as-is.

- [ ] **Step 3: Port `client.js`**

`tethysapp/ngiab/public/app/src/api/client.js`:
```js
import axios from 'axios';
import { getTethysPortalHost } from './utilities.js';

const TETHYS_PORTAL_HOST = getTethysPortalHost();

const apiClient = axios.create({
  baseURL: `${TETHYS_PORTAL_HOST}`,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

function handleSuccess(response) {
  return response.data ? response.data : response;
}
function handleError(error) {
  const res = error.response;
  if (res && res.status === 401) {
    window.location.assign(`${TETHYS_PORTAL_HOST}/accounts/login?next=${window.location.pathname}`);
  }
  return Promise.reject(error);
}
apiClient.interceptors.response.use(handleSuccess, handleError);

export default apiClient;
```

- [ ] **Step 4: Write `app.js` (viewer endpoints only — no datastream)**

`tethysapp/ngiab/public/app/src/api/app.js`:
```js
import apiClient from './client.js';
import { getConfig } from '../config.js';

const url = (name) => `${getConfig().APP_ROOT_URL}${name}/`;

const appAPI = {
  getModelRuns: () => apiClient.get(url('getModelRuns')),
  getGeoSpatialData: (params) => apiClient.get(url('getGeoSpatialData'), { params }),
  getNexusTimeSeries: (params) => apiClient.get(url('getNexusTimeSeries'), { params }),
  getCatchmentTimeSeries: (params) => apiClient.get(url('getCatchmentTimeSeries'), { params }),
  getTrouteVariables: (params) => apiClient.get(url('getTrouteVariables'), { params }),
  getTrouteTimeSeries: (params) => apiClient.get(url('getTrouteTimeSeries'), { params }),
  getTeehrTimeSeries: (params) => apiClient.get(url('getTeehrTimeSeries'), { params }),
  getTeehrVariables: (params) => apiClient.get(url('getTeehrVariables'), { params }),
};

export default appAPI;
```

- [ ] **Step 5: Write the failing test**

`tethysapp/ngiab/public/app/src/api/app.test.js`:
```js
import { expect } from '@esm-bundle/chai';
import apiClient from './client.js';
import appAPI from './app.js';

it('builds endpoint URLs from APP_ROOT_URL and passes params', async () => {
  window.__NGIAB__ = { APP_ROOT_URL: '/apps/ngiab/' };
  let called = null;
  const orig = apiClient.get;
  apiClient.get = (u, opts) => { called = { u, opts }; return Promise.resolve({}); };
  try {
    await appAPI.getGeoSpatialData({ model_run_id: 'run-1' });
    expect(called.u).to.equal('/apps/ngiab/getGeoSpatialData/');
    expect(called.opts).to.deep.equal({ params: { model_run_id: 'run-1' } });
  } finally {
    apiClient.get = orig;
  }
});
```

- [ ] **Step 6: Run test to verify it fails, then passes**

Run: `npx web-test-runner "tethysapp/ngiab/public/app/src/api/app.test.js" --node-resolve` **before** creating the import map for tests will FAIL to resolve `axios`. Use the config from Task 9 instead. If Task 9 is not yet done, temporarily run with:
```bash
npx web-test-runner "tethysapp/ngiab/public/app/src/api/app.test.js" \
  --node-resolve --root-dir . \
  --puppeteer
```
Expected after Task 9 config exists: PASS (1 passing). (This task's test depends on the import-map test config; if executing strictly in order, complete Task 9 then return and confirm PASS.)

- [ ] **Step 7: Commit**

```bash
git add tethysapp/ngiab/public/app/src/api/
git commit -m "feat: port API layer to ES modules (viewer endpoints only)"
```

---

### Task 6: App-store singleton, shell, and one rendering element

**Files:**
- Create: `tethysapp/ngiab/public/app/src/store/app-store.js`
- Create: `tethysapp/ngiab/public/app/src/components/ping/ngiab-ping.js`
- Create: `tethysapp/ngiab/public/app/src/components/ngiab-app.js`
- Test: `tethysapp/ngiab/public/app/src/components/ping/ngiab-ping.test.js`

**Interfaces:**
- Consumes: `createStore` (Task 4).
- Produces: `store` (singleton) and `actions` ({ `setTheme(theme)`, `setModelRun(id)` }) from `app-store.js`; custom elements `<ngiab-app>` and `<ngiab-ping>`.

- [ ] **Step 1: Create the app-store singleton**

`tethysapp/ngiab/public/app/src/store/app-store.js`:
```js
import { createStore } from './store.js';

export const store = createStore({
  modelRunId: null,
  selection: { type: null, id: null },
  variable: null,
  theme: 'light',
});

export const actions = {
  setTheme: (theme) => store.set({ theme }),
  setModelRun: (modelRunId) => store.set({ modelRunId }),
};
```

- [ ] **Step 2: Write the failing component test**

`tethysapp/ngiab/public/app/src/components/ping/ngiab-ping.test.js`:
```js
import { expect } from '@esm-bundle/chai';
import './ngiab-ping.js';
import { actions } from '../../store/app-store.js';

it('renders store state and updates on change', () => {
  const el = document.createElement('ngiab-ping');
  document.body.append(el);
  try {
    actions.setTheme('light');
    expect(el.textContent).to.contain('theme=light');
    actions.setTheme('dark');
    expect(el.textContent).to.contain('theme=dark');
  } finally {
    el.remove();
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx web-test-runner "tethysapp/ngiab/public/app/src/components/ping/ngiab-ping.test.js" --node-resolve`
Expected: FAIL — `./ngiab-ping.js` not found.

- [ ] **Step 4: Implement `ngiab-ping`**

`tethysapp/ngiab/public/app/src/components/ping/ngiab-ping.js`:
```js
import { store } from '../../store/app-store.js';

export class NgiabPing extends HTMLElement {
  connectedCallback() {
    this._unsub = store.subscribe(() => this.render());
    this.render();
  }
  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }
  render() {
    const s = store.get();
    this.textContent = `theme=${s.theme} modelRun=${s.modelRunId ?? 'none'}`;
  }
}
customElements.define('ngiab-ping', NgiabPing);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx web-test-runner "tethysapp/ngiab/public/app/src/components/ping/ngiab-ping.test.js" --node-resolve`
Expected: PASS (1 passing).

- [ ] **Step 6: Implement the shell `ngiab-app`**

`tethysapp/ngiab/public/app/src/components/ngiab-app.js`:
```js
import './ping/ngiab-ping.js';

export class NgiabApp extends HTMLElement {
  connectedCallback() {
    this.innerHTML =
      '<header class="app-header">NGIAB Visualizer</header>' +
      '<main class="app-main"><ngiab-ping></ngiab-ping></main>';
  }
}
customElements.define('ngiab-app', NgiabApp);
```

- [ ] **Step 7: Commit**

```bash
git add tethysapp/ngiab/public/app/src/store/app-store.js tethysapp/ngiab/public/app/src/components/
git commit -m "feat: app-store singleton, app shell, and ping element"
```

---

### Task 7: Entry module

**Files:**
- Create: `tethysapp/ngiab/public/app/src/main.js`

**Interfaces:**
- Consumes: `<ngiab-app>` (Task 6).
- Produces: DOM mount — appends `<ngiab-app>` into `#root`.

- [ ] **Step 1: Write `main.js`**

`tethysapp/ngiab/public/app/src/main.js`:
```js
import './components/ngiab-app.js';

const root = document.getElementById('root');
root.appendChild(document.createElement('ngiab-app'));
```

- [ ] **Step 2: Commit**

```bash
git add tethysapp/ngiab/public/app/src/main.js
git commit -m "feat: frontend entry module mounts ngiab-app"
```

---

### Task 8: Wire the Django template + controller context

**Files:**
- Modify: `tethysapp/ngiab/templates/ngiab/index.html` (full replace)
- Modify: `tethysapp/ngiab/controllers.py:84-88` (the `home` controller)

**Interfaces:**
- Consumes: static files under `/static/ngiab/app/` (Tasks 1–7).
- Produces: an HTML page that injects `window.__NGIAB__`, declares the import map (absolute `{% static %}` URLs), links the stylesheets, and loads `src/main.js` as a module.

- [ ] **Step 1: Pass app root URL into the template context**

Modify `tethysapp/ngiab/controllers.py` `home` controller:
```python
@controller
def home(request):
    """Controller for the app home page."""
    context = {"app_root_url": f"/apps/{App.root_url}/"}
    return App.render(request, "index.html", context)
```
(`App` is already imported. `f"/apps/{App.root_url}/"` reproduces the exact value the old build-time `TETHYS_APP_ROOT_URL` used: `/apps/ngiab/`.)

- [ ] **Step 2: Replace the template**

`tethysapp/ngiab/templates/ngiab/index.html`:
```html
{% load static tethys %}
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#2c3e50" />
    <link rel="shortcut icon" href="{% if site_globals.favicon and 'http' in site_globals.favicon %}{{ site_globals.favicon }}{% elif site_globals.favicon %}{% static site_globals.favicon %}{% else %}{% static 'tethys_portal/images/default_favicon.png' %}{% endif %}" />
    <title>{{ tethys_app.name }}</title>
    <script>
      window.__NGIAB__ = { APP_ROOT_URL: "{{ app_root_url }}", PORTAL_HOST: "" };
    </script>
    <script type="importmap">
    {
      "imports": {
        "axios": "{% static tethys_app|public:'app/vendor/axios.esm.js' %}"
      }
    }
    </script>
    <link rel="stylesheet" href="{% static tethys_app|public:'app/src/styles/tokens.css' %}" />
    <link rel="stylesheet" href="{% static tethys_app|public:'app/src/styles/app.css' %}" />
  </head>
  <body style="margin: 0;">
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
    <script type="module" src="{% static tethys_app|public:'app/src/main.js' %}"></script>
  </body>
</html>
```

- [ ] **Step 3: Start the app and verify the rendered HTML**

Start Tethys (per repo README / `run.sh` / `tethys manage start`), then:
```bash
curl -s http://localhost:8000/apps/ngiab/ | grep -E 'importmap|window.__NGIAB__|app/src/main.js'
```
Expected: three matching lines — the `window.__NGIAB__ = { APP_ROOT_URL: "/apps/ngiab/", ... }` script, the `type="importmap"` block referencing `/static/ngiab/app/vendor/axios.esm.js`, and the module `<script>` for `/static/ngiab/app/src/main.js`.

- [ ] **Step 4: Verify in the browser**

Open `http://localhost:8000/apps/ngiab/`. Expected: the header "NGIAB Visualizer" and the text `theme=light modelRun=none` (the `ngiab-ping` element rendering store state). No console errors about module or import-map resolution.

- [ ] **Step 5: Commit**

```bash
git add tethysapp/ngiab/templates/ngiab/index.html tethysapp/ngiab/controllers.py
git commit -m "feat: serve build-less vanilla frontend from Tethys template"
```

---

### Task 9: Test runner configuration and green suite

**Files:**
- Create: `web-test-runner.config.mjs`
- Modify: `package.json` (add devDeps + a `test:frontend` script)

**Interfaces:**
- Consumes: all `*.test.js` under the frontend `src/`, and vendored `axios` (Task 2).
- Produces: `npm run test:frontend` running the full Phase-0 suite green, with `axios` resolved via an import map that mirrors production.

- [ ] **Step 1: Install dev-only test dependencies**

Run:
```bash
npm install --save-dev @web/test-runner @web/dev-server-import-maps @esm-bundle/chai
```
Expected: added to `devDependencies`; `node_modules/@web/test-runner` exists.

- [ ] **Step 2: Create the test-runner config**

`web-test-runner.config.mjs`:
```js
import { importMapsPlugin } from '@web/dev-server-import-maps';

export default {
  nodeResolve: true,
  files: ['tethysapp/ngiab/public/app/src/**/*.test.js'],
  plugins: [
    importMapsPlugin({
      inject: {
        importMap: {
          imports: {
            // Mirror the production import map so tests exercise the vendored ESM.
            axios: '/tethysapp/ngiab/public/app/vendor/axios.esm.js',
          },
        },
      },
    }),
  ],
};
```

- [ ] **Step 3: Add the npm script**

In `package.json` `"scripts"`, add:
```json
"test:frontend": "web-test-runner"
```
(Leave the existing `test`/`build`/`start` scripts untouched — the React app and its jest tests remain until the Phase 2 cutover.)

- [ ] **Step 4: Run the full Phase-0 suite**

Run: `npm run test:frontend`
Expected: PASS — all tests from Tasks 3, 4, 5, 6 pass (config: 2, store: 3, app: 1, ping: 1).

- [ ] **Step 5: Return to Task 5 Step 6 and confirm the API test passes**

Re-run: `npm run test:frontend`
Expected: the `app.test.js` case passes now that `axios` resolves via the import-map plugin.

- [ ] **Step 6: Commit**

```bash
git add web-test-runner.config.mjs package.json package-lock.json
git commit -m "test: add @web/test-runner config and frontend test script"
```

---

## Self-Review

**Spec coverage (Phase 0 slice):**
- Build-less pipeline (no bundler, ES modules, import map) → Tasks 1, 7, 8, 9. ✅
- Vendored ESM deps (axios this phase) → Task 2, referenced in Tasks 8/9. ✅
- Single global store → Tasks 4, 6. ✅
- Web Components in light DOM → Task 6 (no shadow root used). ✅
- API layer ported verbatim, DataStream removed → Task 5 (no datastream endpoints). ✅
- Runtime config replacing build-time env → Tasks 3, 8. ✅
- Static-base-URL-under-Tethys risk proven → Task 8 (absolute `{% static %}` import-map URLs + curl/browser check). ✅
- Testing via `@web/test-runner` → Task 9. ✅
- Phase 1 items (map, model-runs, chart, widgets, theming toggle UI) are intentionally **out of scope** for Phase 0 and belong to the Phase 1 plan.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. Task 2 Step 2 requires pasting the actual installed axios version (deterministic — read via the given command).

**Type consistency:** `createStore` shape (`get`/`set`/`subscribe`) is identical across Tasks 4, 6. `getConfig()` return shape (`APP_ROOT_URL`, `PORTAL_HOST`) is identical across Tasks 3, 5, 8. `appAPI` method names match the backend controllers in `controllers.py`. The store singleton and `actions` names (`setTheme`, `setModelRun`) match between Tasks 6 and the ping test.

**Known ordering note:** Task 5's API test depends on the import-map test config from Task 9. Task 5 Step 6 and Task 9 Step 5 both call this out; when executing strictly in order, the `app.test.js` assertion is confirmed green at Task 9 Step 5.
