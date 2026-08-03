# Vanilla-JS Migration — Phase 0 (Build-less Scaffold) Implementation Plan

> **Audience: a human implementer.** Every step gives the exact file content or command, what output
> to expect, and what to do when it doesn't match. Work top to bottom; each task ends in a commit, so
> you can stop at any task boundary with a working tree.

**Goal:** Stand up a build-less, vanilla-JS frontend pipeline for the NGIAB app — served by Tethys
with no bundler — proving that native ES modules + a CDN import map + a store + the ported API layer
+ one rendering custom element all work end-to-end under Tethys's `/apps/ngiab/` URL.

**Non-goal:** any actual viewer feature. No map, no charts, no model-run selector. Phase 0 succeeds
when a page at `http://localhost:8000/apps/ngiab/` renders the text `theme=light modelRun=none` from
store state with a clean browser console. That single line proves modules resolve, the import map
works under the Tethys base URL, the store notifies, and custom elements upgrade.

**Architecture:** The app is authored directly under `tethysapp/ngiab/public/frontend/` — source *is*
the served static files, no webpack/Vite, entry point `main.js` (so the served URL
`/static/ngiab/frontend/main.js` is unchanged from the React app's). The browser loads it as a module; bare imports (e.g.
`axios`) resolve through an import map declared in the Django template pointing at pinned `esm.sh`
URLs. Runtime config (the app root URL) is injected by the template into `window.__NGIAB__`. State
lives in one tiny observable store; UI is native custom elements rendering into light DOM.

**Tech Stack:** Vanilla JS (ES modules), native Web Components, CDN dependencies via `esm.sh`,
`@web/test-runner` for tests. Backend unchanged (Tethys/Django).

## Global Constraints

- **No build step.** No bundler, transpiler, JSX, or TypeScript. Plain ES modules run in the browser
  exactly as authored. If you find yourself wanting a build step, stop and reconsider the design.
- **App is served from** `tethysapp/ngiab/public/frontend/` → static URL prefix `/static/ngiab/frontend/`.
- **Never author into `tethysapp/ngiab/public/react-build/`.** That is webpack's output path for the
  legacy React app (`reactapp/config/webpack.config.js:15`) and stays gitignored until Phase 2
  deletes it. Keeping the two dirs separate is what stops `npm run build` from clobbering source.
- **Dependencies come from the `esm.sh` CDN** at **pinned exact versions**, wired via the template
  import map. Nothing is vendored into the repo. No `@latest`, no semver ranges in a URL.
- **Import-map and script URLs must be absolute** (via `{% static %}`). The page is served at
  `/apps/ngiab/` but our files live at `/static/ngiab/frontend/` — a relative specifier resolves against
  the *document* base and 404s. This is the single most likely thing to break; Task 12 proves it.
- **Web Components render into light DOM** (no shadow DOM) so the global stylesheets apply.
- **Single global store.** Components subscribe in `connectedCallback` and **must** unsubscribe in
  `disconnectedCallback`, or you leak a listener per mount.
- **DataStream is removed.** Do not port any `datastream_*` endpoint or view.
- **Commit messages: no AI/Claude attribution.** No `Co-Authored-By: Claude`, no "Generated with"
  footer.
- Work on branch `feature/vanilla-js-migration`.

## Before you start

```bash
cd /home/aquagio/tethysdev/ciroh/ngiab-client
git branch --show-current     # expect: feature/vanilla-js-migration
git status --porcelain         # expect: empty (clean tree)
node --version                 # expect: v18+ (v20+ preferred)
```

You will need, at Task 12, a running Tethys dev server and a browser. Starting the server is
whatever this repo already uses — check `run.sh` and the README; typically:

```bash
tethys manage start          # serves http://localhost:8000
```

The React app can keep working throughout Phase 0 and 1 — you are building the vanilla app
*alongside* it, in the same directory but under different filenames. Two things to know:

- **The React bundle currently does not exist on disk.** Task 1 repointed webpack to
  `public/react-build/` and deleted the stale artifacts from `public/frontend/`. Run `npm run build`
  to regenerate it; the template already points there.
- **Nothing user-facing changes until Task 11** swaps the template to the vanilla entry. That is the
  one cutover moment, and `git revert` undoes it. If you would rather not flip the served page
  mid-development, do Tasks 2–10 and 13 first and leave 11–12 for when you want a browser check.

---

## Task overview

| # | Task | Touches | Test? |
|---|---|---|---|
| 1 | Skeleton dir | `public/frontend/` | — |
| 2 | Pin CDN dependency URLs | `DEPENDENCIES.md` | curl checks |
| 3 | Runtime config module | `config.js` | yes (TDD) |
| 4 | Observable store | `store/store.js` | yes (TDD) |
| 5 | Port the API layer | `api/*` | yes (TDD) |
| 6 | App-store singleton + actions | `store/app-store.js` | yes (TDD) |
| 7 | `<ngiab-ping>` element | `components/ping/` | yes (TDD) |
| 8 | `<ngiab-app>` shell | `components/ngiab-app.js` | yes |
| 9 | Entry module | `main.js` | — |
| 10 | Controller context | `controllers.py` | — |
| 11 | Django template + import map | `templates/ngiab/index.html` | — |
| 12 | End-to-end verification | — | manual |
| 13 | Test runner config + green suite | `web-test-runner.config.mjs` | full suite |
| 14 | Phase 0 wrap-up | plan doc | — |

Tasks 3–7 are **test-driven**: write the test, watch it fail for the right reason, then implement.
Until Task 13 sets up the runner you cannot execute those tests — so either do **Task 13 first** (it
has no dependencies beyond `npm install`) and enjoy TDD properly, or write tests as you go and turn
the whole suite green at Task 13. **Doing Task 13 early is recommended.**

---

### Task 1: Create the skeleton dir and separate the two build outputs — DONE

Already complete; recorded here because the resolution shapes every later task.

`public/frontend/` is the hand-authored vanilla source dir, with `main.js` as the entry — the same
static path the template already loaded, so the served URL never changes. That path was also
webpack's output path, which is the conflict this task resolved: commit `40ec559` un-ignored the dir
and thereby tracked seven React build artifacts as source, and any `npm run build` would have
overwritten hand-authored files.

Resolved by moving the *React* build out of the way rather than the vanilla source:

- `reactapp/config/webpack.config.js:15` now outputs to `public/react-build/`, with `publicPath`
  `/static/ngiab/react-build/` to match.
- `.gitignore` ignores `public/react-build/`; `public/frontend/` is tracked source.
- The seven stale artifacts were deleted from `public/frontend/` — they are regenerable build output.
- The template's React `<script>` now points at `react-build/main.js`, so React keeps working until
  Task 11 replaces the template wholesale.

**One consequence to know:** the React bundle is gone from disk until you rebuild it. Run
`npm run build` if you need the React app served while you work through Phase 0. A rebuild (not just
a file move) is required because the old `publicPath` is compiled into the bundle's chunk and asset
URLs.

**Current state on disk:**

```
tethysapp/ngiab/public/frontend/
  README.md
  styles/tokens.css
  styles/app.css
```

- [x] `reactapp/config/webpack.config.js` outputs to `public/react-build/`
- [x] `.gitignore` ignores `public/react-build/`, not `public/frontend/`
- [x] Stale webpack artifacts removed from `public/frontend/`
- [x] `public/frontend/README.md`
- [x] `public/frontend/styles/tokens.css` — light/dark CSS custom properties
- [x] `public/frontend/styles/app.css` — base layout styles

**Verify (do this now, it is your baseline):**

```bash
find tethysapp/ngiab/public/frontend -type f | sort
git check-ignore -v tethysapp/ngiab/public/react-build/main.js
git check-ignore -q tethysapp/ngiab/public/frontend/main.js && echo "BAD: source dir is ignored" || echo "OK: source dir is tracked"
```

Expected: exactly the three files above; a `check-ignore` hit on `react-build/`; and `OK: source dir
is tracked`.

---

### Task 2: Pin the CDN dependency URLs

**Goal:** one file that is the single source of truth for every third-party URL, with each URL
proven reachable before any code depends on it.

**Why a doc instead of `package.json`:** the runtime deps are no longer npm-managed — the import map
in the template is what the browser actually uses. `package.json` keeps only dev tooling. Without
this file, dependency versions live scattered across a Django template and nobody can audit them.

**Why `esm.sh` and not unpkg/jsDelivr-raw:** `esm.sh` rewrites a package's *internal* imports to
origin-rooted URLs (`/axios@0.30.2/es2022/axios.mjs`) that resolve against `esm.sh` itself, and it
ships an ESM build even for CommonJS-only packages. So one import-map entry per direct dependency is
enough — you never have to map transitive deps. Raw unpkg serves the package as published, which for
CJS packages the browser cannot import at all. Use jsDelivr only for plain `.css` assets, where no
module rewriting is needed.

**Files:**
- Create: `tethysapp/ngiab/public/frontend/DEPENDENCIES.md`

- [ ] **Step 1: Confirm the versions already used by the React app**

Pin to what the React app resolves today, so a dependency's behavior is the only thing *not*
changing during the migration.

```bash
npm ls axios maplibre-gl pmtiles d3-array d3-scale d3-time-format --depth=0
```

Expected (verified 2026-08-03):

```
├── axios@0.30.2
├── d3-array@3.2.4
├── d3-scale@4.0.2
├── d3-time-format@4.1.0
├── maplibre-gl@4.7.1
└── pmtiles@3.2.1
```

If a version differs, use **your** output — update the URLs in Step 2 to match.

- [ ] **Step 2: Write `DEPENDENCIES.md`**

`tethysapp/ngiab/public/frontend/DEPENDENCIES.md`:

```markdown
# Frontend dependencies (CDN, no bundler)

The browser loads these directly. The authoritative wiring is the `<script type="importmap">` block
in `tethysapp/ngiab/templates/ngiab/index.html` — **this file and that import map must agree.**

Rules:
- Pin **exact** versions. Never `@latest`, never a semver range. An upstream publish must not be
  able to change our behavior.
- One entry per *direct* dependency. `esm.sh` rewrites transitive imports to absolute URLs, so
  transitive deps need no entry.
- Bumping a version = edit here, edit the import map, reload, verify. Then commit both together.

## Phase 0 (in use now)

| Package | Version | Import-map URL |
|---|---|---|
| axios | 0.30.2 | `https://esm.sh/axios@0.30.2` |

## Phase 1 (add when the consuming component lands — not before)

| Package | Version | Import-map URL |
|---|---|---|
| maplibre-gl | 4.7.1 | `https://esm.sh/maplibre-gl@4.7.1` |
| pmtiles | 3.2.1 | `https://esm.sh/pmtiles@3.2.1` |
| d3-array | 3.2.4 | `https://esm.sh/d3-array@3.2.4` |
| d3-scale | 4.0.2 | `https://esm.sh/d3-scale@4.0.2` |
| d3-time-format | 4.1.0 | `https://esm.sh/d3-time-format@4.1.0` |
| uplot | 1.6.32 | `https://esm.sh/uplot@1.6.32` |

uPlot is not an npm dependency of the React app (it replaces `@visx/*`), so 1.6.32 is simply the
current release rather than a version inherited from the old stack. Re-check it at Phase 1.

### Stylesheets (plain CSS `<link>`, not import-map entries)

CSS is not a module; it goes in a `<link rel="stylesheet">`. jsDelivr serves the published file
as-is, which is what we want here.

| Package | URL |
|---|---|
| maplibre-gl | `https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css` |
| uplot | `https://cdn.jsdelivr.net/npm/uplot@1.6.32/dist/uPlot.min.css` |

## Accepted tradeoff

CDN delivery means the app needs internet access to load. This regresses nothing real: the basemap
style JSON and `merged.pmtiles` were already fetched from S3 at runtime, so the viewer never worked
air-gapped. Residual exposure: an `esm.sh` outage takes the app down, and a compromised CDN could
serve arbitrary JS. If that becomes unacceptable, mitigate with a CSP `script-src` allowlist plus
import-map `integrity` hashes, or revert to vendored copies.
```

- [ ] **Step 3: Prove the Phase 0 URL actually resolves**

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://esm.sh/axios@0.30.2
```

Expected: `200` and a JavaScript content type (e.g. `application/javascript; charset=utf-8`).

Then confirm it is really an ES module and not an HTML error page:

```bash
curl -sS https://esm.sh/axios@0.30.2 | head -c 300
```

Expected (verified 2026-08-03) — a small shim re-exporting the real build:

```js
/* esm.sh - axios@0.30.2 */
import "/form-data@^4.0.4?target=es2022";
import "/node/buffer.mjs";
import "/node/process.mjs";
export * from "/axios@0.30.2/es2022/axios.mjs";
export { default } from "/axios@0.30.2/es2022/axios.mjs";
```

Those origin-rooted imports are why no transitive entries are needed. If you see `<!DOCTYPE html>`,
the URL is wrong.

- [ ] **Step 4: Optionally pre-check the Phase 1 URLs too**

Cheap insurance against discovering a bad URL mid-feature:

```bash
for u in \
  https://esm.sh/maplibre-gl@4.7.1 \
  https://esm.sh/pmtiles@3.2.1 \
  https://esm.sh/d3-array@3.2.4 \
  https://esm.sh/d3-scale@4.0.2 \
  https://esm.sh/d3-time-format@4.1.0 \
  https://esm.sh/uplot@1.6.32 \
  https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css \
  https://cdn.jsdelivr.net/npm/uplot@1.6.32/dist/uPlot.min.css ; do
  printf '%s  ' "$(curl -sS -o /dev/null -w '%{http_code}' "$u")"; echo "$u"
done
```

Expected: `200` on every line — all nine URLs in this task were verified 2026-08-03.

- [ ] **Step 5: Commit**

```bash
git add tethysapp/ngiab/public/frontend/DEPENDENCIES.md
git commit -m "docs: pin CDN dependency URLs for the vanilla frontend"
```

**If it breaks:** a non-200 from `esm.sh` for a version that exists on npm usually means a build
error on their side for that package — the response body says so. Try the `?bundle` or a slightly
newer patch version, and record whatever you chose in `DEPENDENCIES.md`.

---

### Task 3: Runtime config module

**Goal:** `getConfig()` returns the app's root URL and portal host, read from `window.__NGIAB__`.

**Why:** the React build injected `process.env.TETHYS_APP_ROOT_URL` at *build* time via
`dotenv-webpack`. With no build step there is nothing to substitute, so the value has to arrive at
*runtime* — the Django template writes it into `window.__NGIAB__` (Task 11). Defaults keep the module
usable in tests, where no template ran.

**Files:**
- Create: `tethysapp/ngiab/public/frontend/config.js`
- Create: `tethysapp/ngiab/public/frontend/config.test.js`

**Interface produced:** `getConfig() -> { APP_ROOT_URL: string, PORTAL_HOST: string }`.
Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

`tethysapp/ngiab/public/frontend/config.test.js`:

```js
import { expect } from '@esm-bundle/chai';
import { getConfig } from './config.js';

it('falls back to sane defaults when window.__NGIAB__ is absent', () => {
  delete window.__NGIAB__;
  expect(getConfig().APP_ROOT_URL).to.equal('/apps/ngiab/');
  expect(getConfig().PORTAL_HOST).to.equal('');
});

it('reads values injected by the Django template', () => {
  window.__NGIAB__ = { APP_ROOT_URL: '/portal/apps/ngiab/', PORTAL_HOST: 'https://h' };
  expect(getConfig().APP_ROOT_URL).to.equal('/portal/apps/ngiab/');
  expect(getConfig().PORTAL_HOST).to.equal('https://h');
});

it('ignores empty-string values and uses the default', () => {
  window.__NGIAB__ = { APP_ROOT_URL: '', PORTAL_HOST: '' };
  expect(getConfig().APP_ROOT_URL).to.equal('/apps/ngiab/');
});
```

That third case matters: Django renders `""` when a context key is missing, so an empty string is a
realistic input and must not become the app root URL.

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:frontend
```

Expected failure: cannot resolve `./config.js` (module not found). **If the error is anything else**
— e.g. `test:frontend` is not a script — do Task 13 first.

- [ ] **Step 3: Implement**

`tethysapp/ngiab/public/frontend/config.js`:

```js
// Runtime config, injected by the Django template into window.__NGIAB__.
// Replaces the React build's compile-time process.env substitution.
export function getConfig() {
  const cfg = (typeof window !== 'undefined' && window.__NGIAB__) || {};
  return {
    APP_ROOT_URL: cfg.APP_ROOT_URL || '/apps/ngiab/',
    PORTAL_HOST: cfg.PORTAL_HOST || '',
  };
}
```

`||` (not `??`) is deliberate — it treats `''` as absent, which is what Step 1's third test asserts.

- [ ] **Step 4: Run it and watch it pass**

```bash
npm run test:frontend
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add tethysapp/ngiab/public/frontend/config.js tethysapp/ngiab/public/frontend/config.test.js
git commit -m "feat: runtime config module reading window.__NGIAB__"
```

---

### Task 4: The observable store

**Goal:** ~15 lines replacing React Context + `useReducer`: `get()`, `set(patch)`, `subscribe(fn)`.

**Why so small:** the React app's state is a handful of IDs and booleans consumed by a handful of
components. A shallow-merge store with subscriber notification covers all of it. Resist adding
selectors, middleware, immutability helpers, or path-based subscriptions until a component actually
needs one.

**Files:**
- Create: `tethysapp/ngiab/public/frontend/store/store.js`
- Create: `tethysapp/ngiab/public/frontend/store/store.test.js`

**Interface produced:** `createStore(initialState) -> { get, set, subscribe }` where `subscribe`
returns an unsubscribe function. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

`tethysapp/ngiab/public/frontend/store/store.test.js`:

```js
import { expect } from '@esm-bundle/chai';
import { createStore } from './store.js';

it('returns the initial state from get()', () => {
  const s = createStore({ a: 1 });
  expect(s.get()).to.deep.equal({ a: 1 });
});

it('does not alias the caller\'s initial-state object', () => {
  const initial = { a: 1 };
  const s = createStore(initial);
  s.set({ a: 2 });
  expect(initial.a).to.equal(1);
});

it('set() shallow-merges a patch and notifies subscribers', () => {
  const s = createStore({ a: 1, b: 2 });
  let seen = null;
  s.subscribe((state) => { seen = state; });
  s.set({ b: 3 });
  expect(s.get()).to.deep.equal({ a: 1, b: 3 });
  expect(seen).to.deep.equal({ a: 1, b: 3 });
});

it('notifies every subscriber', () => {
  const s = createStore({ a: 1 });
  let calls = 0;
  s.subscribe(() => { calls += 1; });
  s.subscribe(() => { calls += 1; });
  s.set({ a: 2 });
  expect(calls).to.equal(2);
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

it('replaces state rather than mutating it, so snapshots stay stable', () => {
  const s = createStore({ a: 1 });
  const before = s.get();
  s.set({ a: 2 });
  expect(before).to.deep.equal({ a: 1 });
  expect(s.get()).to.not.equal(before);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:frontend
```

Expected: cannot resolve `./store.js`.

- [ ] **Step 3: Implement**

`tethysapp/ngiab/public/frontend/store/store.js`:

```js
// Minimal observable store: get / set (shallow merge) / subscribe.
// Replaces React Context + useReducer. No deps.
export function createStore(initialState) {
  let state = { ...initialState };
  const subscribers = new Set();
  return {
    get() {
      return state;
    },
    set(patch) {
      state = { ...state, ...patch };
      // Copy before iterating: a subscriber may unsubscribe during notification.
      for (const fn of [...subscribers]) fn(state);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
```

Two details worth keeping: `{ ...initialState }` prevents aliasing the caller's object, and iterating
a copy of `subscribers` means a component that unsubscribes inside its own handler cannot corrupt the
in-flight loop.

- [ ] **Step 4: Run it and watch it pass**

```bash
npm run test:frontend
```

Expected: 6 passing (plus Task 3's 3).

- [ ] **Step 5: Commit**

```bash
git add tethysapp/ngiab/public/frontend/store/
git commit -m "feat: minimal observable store"
```

---

### Task 5: Port the API layer (DataStream removed)

**Goal:** the four `services/` modules from `reactapp/`, as plain ES modules with relative imports.

**Why it changes at all:** the React versions rely on webpack's `modules: [reactapp]` resolution to
import `'services/api/client'` as a bare specifier. The browser has no such resolution, so every
local import becomes an explicit relative path with a `.js` extension. Two real fixes travel with the
port, both called out below.

**Files:**
- Create: `tethysapp/ngiab/public/frontend/api/utilities.js`
- Create: `tethysapp/ngiab/public/frontend/api/tethys.js`
- Create: `tethysapp/ngiab/public/frontend/api/client.js`
- Create: `tethysapp/ngiab/public/frontend/api/app.js`
- Create: `tethysapp/ngiab/public/frontend/api/app.test.js`

**Interface produced:** default export `appAPI` with `getModelRuns`, `getGeoSpatialData`,
`getNexusTimeSeries`, `getCatchmentTimeSeries`, `getTrouteVariables`, `getTrouteTimeSeries`,
`getTeehrTimeSeries`, `getTeehrVariables`, `getTeehrLocations`. Every name matches a `@controller` in
`tethysapp/ngiab/controllers.py` — verify with `grep -n '^def ' tethysapp/ngiab/controllers.py`.

- [ ] **Step 1: Port `utilities.js`**

Source: `reactapp/services/utilities.js`. The only change is the config source —
`process.env.TETHYS_PORTAL_HOST` does not exist at runtime.

`tethysapp/ngiab/public/frontend/api/utilities.js`:

```js
import { getConfig } from '../config.js';

// Portal host: the injected runtime config, else the current origin.
export function getTethysPortalHost() {
  const host = getConfig().PORTAL_HOST;
  if (host && host.length) return host;
  return new URL(window.location.href).origin;
}
```

- [ ] **Step 2: Port `tethys.js`**

Source: `reactapp/services/api/tethys.js`, verbatim except the import specifier.

`tethysapp/ngiab/public/frontend/api/tethys.js`:

```js
import apiClient from './client.js';

function getCSRF() {
  return apiClient.get('/api/csrf/').then((response) => response.headers['x-csrftoken']);
}

function getSession() {
  getCSRF();
  return apiClient.get('/api/session/');
}

function getUserData() {
  return apiClient.get('/api/whoami/');
}

function getAppData(tethys_app_url) {
  return apiClient.get(`/api/apps/${tethys_app_url}/`);
}

const tethysAPI = { getSession, getCSRF, getAppData, getUserData };

export default tethysAPI;
```

Nothing in the viewer calls these today — `client.js` imported the module and never used it. It is
ported because Phase 1 may need CSRF for a POST, and it costs four lines. If Phase 1 ends without a
caller, delete it at the Phase 2 cutover.

- [ ] **Step 3: Port `client.js`**

Two deliberate changes from the React version, both bug fixes:

1. **Drop the unused `tethysAPI` import.** It created a circular import (`client` → `tethys` →
   `client`) for no benefit. Native ESM tolerates cycles, but there is no reason to keep one.
2. **Guard `error.response`.** The original does `if (res.status === 401)`, which throws
   `TypeError: Cannot read properties of undefined` on any network-level failure (server down, CORS,
   timeout) — masking the real error with a confusing one.

`tethysapp/ngiab/public/frontend/api/client.js`:

```js
import axios from 'axios';
import { getTethysPortalHost } from './utilities.js';

const TETHYS_PORTAL_HOST = getTethysPortalHost();

const apiClient = axios.create({
  baseURL: `${TETHYS_PORTAL_HOST}`,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

function handleSuccess(response) {
  return response.data ? response.data : response;
}

function handleError(error) {
  const res = error.response;
  // res is undefined for network-level failures — do not dereference it blindly.
  if (res && res.status === 401) {
    // Redirect to the Tethys Portal login.
    window.location.assign(`${TETHYS_PORTAL_HOST}/accounts/login?next=${window.location.pathname}`);
  }
  return Promise.reject(error);
}

apiClient.interceptors.response.use(handleSuccess, handleError);

export default apiClient;
```

Note `axios` here is a **bare specifier**. It resolves via the import map in the browser (Task 11)
and via `nodeResolve` in tests (Task 13). It will fail with "Failed to resolve module specifier" in
any context that provides neither — that error means your import map did not load, not that the code
is wrong.

- [ ] **Step 4: Write `app.js` — viewer endpoints only**

`tethysapp/ngiab/public/frontend/api/app.js`:

```js
import apiClient from './client.js';
import { getConfig } from '../config.js';

// Endpoints are resolved at call time, not module load — getConfig() reads window.__NGIAB__,
// which tests reassign between cases.
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
  getTeehrLocations: (params) => apiClient.get(url('getTeehrLocations'), { params }),
};

export default appAPI;
```

**Do not add** `makeDatastreamConf`, `getDataStream*`, or `checkForTarFile`. Those controllers still
exist in `controllers.py` but become dead code, deleted at the Phase 2 cutover.

`importModelRuns` is also omitted — check whether the React app calls it
(`grep -rn "importModelRuns" reactapp/`) and if a Phase 1 view needs it, add it then.

- [ ] **Step 5: Write the test**

`tethysapp/ngiab/public/frontend/api/app.test.js`:

```js
import { expect } from '@esm-bundle/chai';
import apiClient from './client.js';
import appAPI from './app.js';

// Swap apiClient.get for a spy rather than mocking the network — we are testing URL
// construction and param passing, not axios.
function withStubbedGet(fn) {
  const calls = [];
  const orig = apiClient.get;
  apiClient.get = (u, opts) => {
    calls.push({ u, opts });
    return Promise.resolve({});
  };
  return Promise.resolve(fn(calls)).finally(() => {
    apiClient.get = orig;
  });
}

it('builds endpoint URLs from APP_ROOT_URL and forwards params', () =>
  withStubbedGet(async (calls) => {
    window.__NGIAB__ = { APP_ROOT_URL: '/apps/ngiab/' };
    await appAPI.getGeoSpatialData({ model_run_id: 'run-1' });
    expect(calls[0].u).to.equal('/apps/ngiab/getGeoSpatialData/');
    expect(calls[0].opts).to.deep.equal({ params: { model_run_id: 'run-1' } });
  }));

it('honours a non-default APP_ROOT_URL', () =>
  withStubbedGet(async (calls) => {
    window.__NGIAB__ = { APP_ROOT_URL: '/portal/apps/ngiab/' };
    await appAPI.getModelRuns();
    expect(calls[0].u).to.equal('/portal/apps/ngiab/getModelRuns/');
  }));

it('exposes exactly the viewer endpoints and no datastream ones', () => {
  expect(Object.keys(appAPI).sort()).to.deep.equal([
    'getCatchmentTimeSeries',
    'getGeoSpatialData',
    'getModelRuns',
    'getNexusTimeSeries',
    'getTeehrLocations',
    'getTeehrTimeSeries',
    'getTeehrVariables',
    'getTrouteTimeSeries',
    'getTrouteVariables',
  ]);
});
```

That last case is a guard rail: it fails loudly if someone reintroduces a DataStream endpoint.

- [ ] **Step 6: Run the test**

```bash
npm run test:frontend
```

Expected: 3 passing here. If you see `Failed to resolve module specifier "axios"`, Task 13's
`nodeResolve` is not configured — that is the fix, not a code change.

- [ ] **Step 7: Commit**

```bash
git add tethysapp/ngiab/public/frontend/api/
git commit -m "feat: port API layer to ES modules (viewer endpoints only)"
```

---

### Task 6: App-store singleton and actions

**Goal:** the one store instance the whole app shares, plus named mutators.

**Why actions instead of calling `store.set()` from components:** it keeps the set of legal state
transitions in one readable file and mirrors the React app's reducer action names, so Phase 1 ports
are close to 1:1. Phase 0 needs only two actions; Phase 1 adds the rest.

**Files:**
- Create: `tethysapp/ngiab/public/frontend/store/app-store.js`
- Create: `tethysapp/ngiab/public/frontend/store/app-store.test.js`

**Interface produced:** named exports `store` and `actions` (`setTheme(theme)`, `setModelRun(id)`).

- [ ] **Step 1: Write the failing test**

`tethysapp/ngiab/public/frontend/store/app-store.test.js`:

```js
import { expect } from '@esm-bundle/chai';
import { store, actions } from './app-store.js';

it('starts with the documented initial shape', () => {
  const s = store.get();
  expect(s).to.have.property('modelRunId');
  expect(s).to.have.property('selection');
  expect(s).to.have.property('variable');
  expect(s.theme).to.be.oneOf(['light', 'dark']);
});

it('setTheme updates only the theme', () => {
  actions.setModelRun('run-7');
  actions.setTheme('dark');
  expect(store.get().theme).to.equal('dark');
  expect(store.get().modelRunId).to.equal('run-7');
  actions.setTheme('light');
});

it('setModelRun updates only the model run', () => {
  actions.setTheme('light');
  actions.setModelRun('run-9');
  expect(store.get().modelRunId).to.equal('run-9');
  expect(store.get().theme).to.equal('light');
});
```

The store is a module-level singleton, so it is shared across test cases in a file — each case sets
what it depends on rather than assuming a fresh store.

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:frontend
```

- [ ] **Step 3: Implement**

`tethysapp/ngiab/public/frontend/store/app-store.js`:

```js
import { createStore } from './store.js';

// The single app-wide store. Phase 1 grows this shape: trouteId, teehrId, layers.
export const store = createStore({
  modelRunId: null,
  selection: { type: null, id: null }, // type: 'nexus' | 'catchment'
  variable: null,
  theme: 'light', // 'light' | 'dark'
});

export const actions = {
  setTheme: (theme) => store.set({ theme }),
  setModelRun: (modelRunId) => store.set({ modelRunId }),
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm run test:frontend
```

Expected: 3 passing here.

- [ ] **Step 5: Commit**

```bash
git add tethysapp/ngiab/public/frontend/store/app-store.js tethysapp/ngiab/public/frontend/store/app-store.test.js
git commit -m "feat: app-store singleton with named actions"
```

---

### Task 7: The `<ngiab-ping>` element

**Goal:** the smallest possible custom element that reads store state and re-renders on change. This
is Phase 0's actual proof-of-life and the template every Phase 1 component follows.

**Why a throwaway element:** it isolates "does the Web Component + store + module pipeline work"
from "does the map work". When Phase 1's map misbehaves you will want to know this layer was already
proven. Delete it once `<ngiab-map>` renders.

**Files:**
- Create: `tethysapp/ngiab/public/frontend/components/ping/ngiab-ping.js`
- Create: `tethysapp/ngiab/public/frontend/components/ping/ngiab-ping.test.js`

- [ ] **Step 1: Write the failing test**

`tethysapp/ngiab/public/frontend/components/ping/ngiab-ping.test.js`:

```js
import { expect } from '@esm-bundle/chai';
import './ngiab-ping.js';
import { store, actions } from '../../store/app-store.js';

it('renders current store state on connect', () => {
  actions.setTheme('light');
  actions.setModelRun(null);
  const el = document.createElement('ngiab-ping');
  document.body.append(el);
  try {
    expect(el.textContent).to.contain('theme=light');
    expect(el.textContent).to.contain('modelRun=none');
  } finally {
    el.remove();
  }
});

it('re-renders when the store changes', () => {
  const el = document.createElement('ngiab-ping');
  document.body.append(el);
  try {
    actions.setTheme('dark');
    expect(el.textContent).to.contain('theme=dark');
    actions.setModelRun('run-1');
    expect(el.textContent).to.contain('modelRun=run-1');
  } finally {
    el.remove();
    actions.setTheme('light');
  }
});

it('unsubscribes on disconnect so a removed element stops updating', () => {
  const el = document.createElement('ngiab-ping');
  document.body.append(el);
  el.remove();
  const before = el.textContent;
  actions.setTheme('dark');
  expect(el.textContent).to.equal(before);
  actions.setTheme('light');
});

it('renders into light DOM so global CSS applies', () => {
  const el = document.createElement('ngiab-ping');
  document.body.append(el);
  try {
    expect(el.shadowRoot).to.equal(null);
  } finally {
    el.remove();
  }
});
```

Cases 3 and 4 encode the two constraints that are easy to violate silently: leaked subscriptions and
accidental shadow DOM.

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:frontend
```

- [ ] **Step 3: Implement**

`tethysapp/ngiab/public/frontend/components/ping/ngiab-ping.js`:

```js
import { store } from '../../store/app-store.js';

// Phase 0 proof-of-life: renders store state, nothing more. Delete once <ngiab-map> lands.
// This is the canonical component shape — subscribe on connect, unsubscribe on disconnect,
// render into light DOM.
export class NgiabPing extends HTMLElement {
  connectedCallback() {
    this._unsubscribe = store.subscribe(() => this.render());
    this.render();
  }

  disconnectedCallback() {
    // Required — without this every mount leaks a store subscriber.
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  render() {
    const { theme, modelRunId } = store.get();
    this.textContent = `theme=${theme} modelRun=${modelRunId ?? 'none'}`;
  }
}

customElements.define('ngiab-ping', NgiabPing);
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm run test:frontend
```

Expected: 4 passing here.

- [ ] **Step 5: Commit**

```bash
git add tethysapp/ngiab/public/frontend/components/ping/
git commit -m "feat: ngiab-ping element rendering store state"
```

---

### Task 8: The `<ngiab-app>` shell

**Goal:** the layout shell that Phase 1 hangs real components off.

**Files:**
- Create: `tethysapp/ngiab/public/frontend/components/ngiab-app.js`
- Create: `tethysapp/ngiab/public/frontend/components/ngiab-app.test.js`

- [ ] **Step 1: Write the test**

`tethysapp/ngiab/public/frontend/components/ngiab-app.test.js`:

```js
import { expect } from '@esm-bundle/chai';
import './ngiab-app.js';

it('renders a header and mounts the ping element', () => {
  const el = document.createElement('ngiab-app');
  document.body.append(el);
  try {
    expect(el.querySelector('.app-header')).to.not.equal(null);
    const ping = el.querySelector('ngiab-ping');
    expect(ping).to.not.equal(null);
    expect(ping.textContent).to.contain('theme=');
  } finally {
    el.remove();
  }
});
```

The `ping.textContent` assertion confirms the child element *upgraded* — that importing
`ngiab-app.js` transitively registered `ngiab-ping`. A bare unregistered `<ngiab-ping>` tag would
render empty and pass a weaker test.

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:frontend
```

- [ ] **Step 3: Implement**

`tethysapp/ngiab/public/frontend/components/ngiab-app.js`:

```js
// Importing for the side effect of customElements.define — the shell owns which
// components exist in the tree.
import './ping/ngiab-ping.js';

export class NgiabApp extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="app-header">NGIAB Visualizer</header>
      <main class="app-main"><ngiab-ping></ngiab-ping></main>
    `;
  }
}

customElements.define('ngiab-app', NgiabApp);
```

- [ ] **Step 4: Run it and watch it pass, then commit**

```bash
npm run test:frontend
git add tethysapp/ngiab/public/frontend/components/ngiab-app.js tethysapp/ngiab/public/frontend/components/ngiab-app.test.js
git commit -m "feat: ngiab-app shell element"
```

---

### Task 9: The entry module

**Goal:** mount the shell into the page's `#root`.

**Files:**
- Create: `tethysapp/ngiab/public/frontend/main.js`

- [ ] **Step 1: Write `main.js`**

`tethysapp/ngiab/public/frontend/main.js`:

```js
import './components/ngiab-app.js';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root not found — check tethysapp/ngiab/templates/ngiab/index.html');
}
root.appendChild(document.createElement('ngiab-app'));
```

The explicit `#root` check turns a silent blank page into a console error naming the file to fix.
No `DOMContentLoaded` wrapper is needed: `<script type="module">` is deferred by default, so the
document is parsed by the time this runs.

- [ ] **Step 2: Commit**

```bash
git add tethysapp/ngiab/public/frontend/main.js
git commit -m "feat: frontend entry module mounts ngiab-app"
```

There is no test here — `main.js` is untestable glue whose only behavior is proven by Task 12.

---

### Task 10: Pass the app root URL into the template context

> **If you did the map spike first** (`docs/superpowers/plans/2026-08-03-map-spike-plan.md`), its
> Task 3 already made this exact change — skip to Task 12 and verify. Tasks 10 and 11 here are
> written for the case where Phase 0 lands before the spike.

**Goal:** make `{{ app_root_url }}` available to the template.

**Why:** `getConfig()` needs the real value under whatever portal prefix the app is deployed at.
`f"/apps/{App.root_url}/"` reproduces exactly what the old build-time `TETHYS_APP_ROOT_URL`
contained. `App.root_url` is `"ngiab"` (`tethysapp/ngiab/app.py:15`), so this renders `/apps/ngiab/`.

**Files:**
- Modify: `tethysapp/ngiab/controllers.py` — the `home` controller at line ~84

- [ ] **Step 1: Edit the controller**

Replace:

```python
@controller
def home(request):
    """Controller for the app home page."""
    # The index.html template loads the React frontend
    return App.render(request, "index.html")
```

with:

```python
@controller
def home(request):
    """Controller for the app home page."""
    # The index.html template loads the build-less vanilla frontend from
    # public/frontend/ and injects runtime config into window.__NGIAB__.
    context = {"app_root_url": f"/apps/{App.root_url}/"}
    return App.render(request, "index.html", context)
```

`App` is already imported at the top of the file — no new import.

- [ ] **Step 2: Verify it parses**

```bash
python -c "import ast,sys; ast.parse(open('tethysapp/ngiab/controllers.py').read()); print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add tethysapp/ngiab/controllers.py
git commit -m "feat: pass app_root_url into the index template context"
```

---

### Task 11: The Django template — import map and module script

> **If you did the map spike first,** its Task 3 already replaced this template and removed the React
> script. Reconcile rather than replace: add `axios` to the existing import map and add the
> `main.js` module script alongside the map partial's. Do **not** paste the template below over the
> spike's — you would drop the `maplibre-gl`/`pmtiles` entries and the `{% include %}`.

**Goal:** replace the React-loading template with one that declares the CDN import map, injects
runtime config, links the stylesheets, and loads `main.js` as a module.

**This is the task most likely to bite.** Four ordering/resolution rules, all load-bearing:

1. **The import map must appear before the first module script.** A `type="importmap"` encountered
   after any module has started loading is ignored, and you get "Failed to resolve module specifier".
2. **Exactly one import map per document.** Not a problem here, but relevant if a Tethys base
   template ever adds one.
3. **Every URL must be absolute**, via `{% static %}`. The page is at `/apps/ngiab/` and our files
   are at `/static/ngiab/frontend/` — a relative `src="main.js"` resolves to `/apps/ngiab/main.js`
   and 404s.
4. **`window.__NGIAB__` must be set before `main.js` runs.** A classic `<script>` in `<head>`
   satisfies this: module scripts are deferred, classic inline scripts are not.

**Files:**
- Modify: `tethysapp/ngiab/templates/ngiab/index.html` (full replace)

- [ ] **Step 1: Note what the current template does**

It is a short page whose only job is loading one classic webpack bundle:

```html
<script src="{% static tethys_app|public:'react-build/main.js' %}"></script>
```

`tethys_app|public:'…'` is the Tethys filter mapping a path inside the app's `public/` dir to its
static URL — `react-build/main.js` → `/static/ngiab/react-build/main.js`. Keep the filter and keep
`{% load static tethys %}` on line 1; without that load tag the filter is silently undefined and
renders an empty `href`/`src`.

Three things change in Step 2: the path becomes `frontend/main.js` (the vanilla entry), the script
gains `type="module"`, and the import map plus runtime-config block appear above it. **This is the
cutover moment** — after this commit the served page is the vanilla scaffold, not React. `git revert`
is your undo.

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

    <!-- Runtime config. Classic inline script, so it runs before the deferred module below. -->
    <script>
      window.__NGIAB__ = {
        APP_ROOT_URL: "{{ app_root_url|escapejs }}",
        PORTAL_HOST: ""
      };
    </script>

    <!-- Import map for bare specifiers. MUST come before any module script.
         Versions are pinned and documented in public/frontend/DEPENDENCIES.md. -->
    <script type="importmap">
    {
      "imports": {
        "axios": "https://esm.sh/axios@0.30.2"
      }
    }
    </script>

    <link rel="stylesheet" href="{% static tethys_app|public:'frontend/styles/tokens.css' %}" />
    <link rel="stylesheet" href="{% static tethys_app|public:'frontend/styles/app.css' %}" />
  </head>
  <body style="margin: 0;">
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
    <script type="module" src="{% static tethys_app|public:'frontend/main.js' %}"></script>
  </body>
</html>
```

`|escapejs` guards the injected value: `/apps/ngiab/` is harmless, but the filter is correct practice
for anything interpolated into a JS string literal, and Django's default HTML autoescaping is not the
right escaping for that context.

- [ ] **Step 3: Commit**

```bash
git add tethysapp/ngiab/templates/ngiab/index.html
git commit -m "feat: serve build-less vanilla frontend from the Tethys template"
```

Do **not** skip to Task 12 assuming this worked — the whole point of Task 12 is that template
mistakes are invisible until rendered.

---

### Task 12: End-to-end verification

**Goal:** prove the pipeline in a real browser under the real Tethys URL. This is the task the whole
phase exists for.

- [ ] **Step 1: Make sure the new static dir is collected**

You added a directory that did not exist when static files were last collected. In `DEBUG` mode
Django serves app statics directly and you can skip this; in a production-style container you cannot.
If Task 12 Step 3 returns 404 for the CSS or JS, this is why:

```bash
tethys manage collectstatic
```

- [ ] **Step 2: Start the server**

```bash
tethys manage start
```

- [ ] **Step 3: Check the rendered HTML**

```bash
curl -s http://localhost:8000/apps/ngiab/ | grep -E 'importmap|__NGIAB__|APP_ROOT_URL|frontend/main.js|esm.sh'
```

Expected, all present:
- `window.__NGIAB__ = {` followed by `APP_ROOT_URL: "/apps/ngiab/"`
- `<script type="importmap">` containing `https://esm.sh/axios@0.30.2`
- `<script type="module" src="/static/ngiab/frontend/main.js">`

Then confirm the static files are actually served — a rendered URL is not a working URL:

```bash
for p in frontend/main.js frontend/styles/app.css frontend/styles/tokens.css \
         frontend/components/ngiab-app.js frontend/store/app-store.js ; do
  printf '%s  %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' "http://localhost:8000/static/ngiab/$p")" "$p"
done
```

Expected: `200` on every line.

- [ ] **Step 4: Open it in a browser**

Go to `http://localhost:8000/apps/ngiab/`.

Expected:
- The header **NGIAB Visualizer**.
- Below it, the text **`theme=light modelRun=none`**.
- A **clean console** — no module-resolution errors, no 404s.

- [ ] **Step 5: Confirm the store is live**

In the browser console:

```js
document.querySelector('ngiab-ping').textContent
```

Expected: `"theme=light modelRun=none"`. Phase 0 does not export the store globally, so to watch a
live update paste this:

```js
const { actions } = await import('/static/ngiab/frontend/store/app-store.js');
actions.setTheme('dark');
document.querySelector('ngiab-ping').textContent;   // "theme=dark modelRun=none"
```

If the text changes, **Phase 0 is proven**: modules resolve under the Tethys base URL, the import map
works, the store notifies, and the custom element re-renders.

Note this dynamic `import()` returns the *same* module instance the page already loaded, which is
exactly why mutating it updates the visible element.

- [ ] **Step 6: Nothing to commit** — verification only. Record the result in Task 14.

**If it breaks:**

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, console: `Failed to resolve module specifier "axios"` | Import map missing, malformed JSON, or placed after a module script | Check Task 11 rules 1–2; view-source and confirm the `importmap` block precedes the module `<script>` |
| 404 on `/static/ngiab/frontend/main.js` | Static files not collected, or the template still points at `react-build/main.js` | Task 12 Step 1; confirm Task 11 Step 2 changed the path to `frontend/main.js` and added `type="module"` |
| The old React app renders instead of the scaffold | Task 11 not applied, or a stale collected copy of the template | Re-run `tethys manage collectstatic`, hard-reload; confirm view-source shows the `importmap` block |
| Header renders, no `theme=…` text | `ngiab-ping` never registered, or JS threw before mount | Console will show the throw; check that `ngiab-app.js` imports `./ping/ngiab-ping.js` |
| Console: `#root not found` | Template lost `<div id="root">` | Restore it in Task 11's body |
| Unstyled page | Stylesheet 404, or `{% load static tethys %}` missing so the filter silently produced nothing | View-source and check the `<link href>` values are non-empty |
| `APP_ROOT_URL: ""` in source | Task 10 not done, or context key misspelled | Confirm the controller passes `app_root_url` |
| Everything 200 but console shows a CORS/network error for `esm.sh` | No internet, or a proxy blocks it | Confirm with `curl https://esm.sh/axios@0.30.2`; this is the accepted CDN tradeoff |

---

### Task 13: Test runner configuration and a green suite

**Do this first if you want real TDD** — it has no dependency on Tasks 2–12.

**Goal:** `npm run test:frontend` runs every `*.test.js` under `public/frontend/` in a real browser.

**Why `@web/test-runner`:** it serves native ES modules to an actual browser, so the code under test
is byte-for-byte what production runs. jsdom under jest would need a transform step — reintroducing
the build we just deleted — and would not exercise real custom-element upgrade semantics.

**Why `nodeResolve` and not a production-mirroring import map:** the bare `axios` specifier has to
resolve somehow. `nodeResolve` points it at `node_modules/axios`, which is already installed at
**0.30.2 — the exact version pinned in `DEPENDENCIES.md`**. Same code, and the suite runs without
network access. The cost: if you bump the CDN pin, bump the npm dep too or the two silently diverge.
Task 14 records that coupling.

**Files:**
- Create: `web-test-runner.config.mjs` (repo root)
- Modify: `package.json` — add devDependencies and the `test:frontend` script

- [ ] **Step 1: Install the dev-only dependencies**

```bash
npm install --save-dev @web/test-runner @esm-bundle/chai
```

Expected: both land in `devDependencies`; `node_modules/@web/test-runner/` exists.

These are **dev-only** and never needed to serve the app — the no-build-step rule is intact.

- [ ] **Step 2: Create the config**

`web-test-runner.config.mjs`:

```js
export default {
  // Resolves bare specifiers (axios) from node_modules. Keep the installed axios version
  // in sync with the CDN pin in tethysapp/ngiab/public/frontend/DEPENDENCIES.md.
  nodeResolve: true,
  files: ['tethysapp/ngiab/public/frontend/**/*.test.js'],
};
```

- [ ] **Step 3: Add the npm script**

In `package.json` `"scripts"`, add:

```json
"test:frontend": "web-test-runner"
```

Leave `test`, `build`, and `start` untouched — the React app and its jest suite stay alive until the
Phase 2 cutover.

- [ ] **Step 4: Run the whole suite**

```bash
npm run test:frontend
```

Expected once Tasks 3–8 are done — **19 passing**:

| File | Cases |
|---|---|
| `config.test.js` | 3 |
| `store/store.test.js` | 6 |
| `store/app-store.test.js` | 3 |
| `api/app.test.js` | 3 |
| `components/ping/ngiab-ping.test.js` | 4 |
| `components/ngiab-app.test.js` | 1 |

- [ ] **Step 5: Commit**

```bash
git add web-test-runner.config.mjs package.json package-lock.json
git commit -m "test: add @web/test-runner config and frontend test script"
```

**If it breaks:**

| Symptom | Fix |
|---|---|
| `Could not find a browser` / Chrome launch failure (common in WSL2) | Install the puppeteer launcher: `npm i -D @web/test-runner-puppeteer`, then add to the config: `import { puppeteerLauncher } from '@web/test-runner-puppeteer';` and `browsers: [puppeteerLauncher()]` |
| `Failed to resolve module specifier "axios"` | `nodeResolve: true` missing, or axios not installed — `npm ls axios` |
| Zero tests found | The `files` glob is relative to the repo root; run `npm run test:frontend` from the root, not from inside `public/frontend/` |
| A store test fails only when the full suite runs | Cross-file singleton leakage — have each case set the state it depends on rather than assuming a fresh store |

---

### Task 14: Phase 0 wrap-up

- [ ] **Step 1: Confirm the phase is actually done**

```bash
npm run test:frontend        # 19 passing
git status --porcelain       # empty
```

Plus the Task 12 browser check passing: header, `theme=light modelRun=none`, clean console.

- [ ] **Step 2: Record the two live coupling points**

Append to `tethysapp/ngiab/public/frontend/DEPENDENCIES.md`:

```markdown
## Coupling to keep in sync

1. **Import map ↔ this file.** The browser uses the import map in
   `tethysapp/ngiab/templates/ngiab/index.html`. Changing a version means editing both.
2. **CDN pin ↔ npm devDependency.** Tests resolve `axios` from `node_modules` via `nodeResolve`,
   production resolves it from `esm.sh`. Both must be the same version or tests exercise different
   code than production ships.
```

- [ ] **Step 3: Commit and push**

```bash
git add tethysapp/ngiab/public/frontend/DEPENDENCIES.md
git commit -m "docs: record CDN/import-map/npm coupling points"
git push -u origin feature/vanilla-js-migration
```

- [ ] **Step 4: Hand off to Phase 1**

Phase 1 needs its own plan. Its first three decisions, all deferred from the design spec:

1. **The searchable-select question** — native `<select>`, a hand-rolled `ngiab-select`, or one small
   CDN dep (Tom Select). Decide against a real model-run list, not in the abstract.
2. **Re-check uPlot's pin.** 1.6.32 is recorded in `DEPENDENCIES.md`; confirm it is still current and
   that the API matches what `ngiab-chart` needs before building against it.
3. **Whether `<ngiab-map>` needs the store or props.** The map is the one component heavy enough that
   a global-store subscription might cause redundant work; measure before adding machinery.

Delete `components/ping/` once `<ngiab-map>` renders — it has served its purpose.

---

## Self-Review

**Spec coverage (Phase 0 slice):**
- Build-less pipeline (no bundler, native ES modules, import map) → Tasks 9, 11, 13. ✅
- CDN dependencies at pinned exact versions → Task 2, wired in Task 11, mirrored in Task 13. ✅
- Single global store → Tasks 4, 6. ✅
- Web Components in light DOM → Tasks 7, 8 (asserted, not just assumed: `ngiab-ping.test.js` checks
  `shadowRoot === null`). ✅
- API layer ported, DataStream removed → Task 5 (with a test asserting no datastream endpoints). ✅
- Runtime config replacing build-time env substitution → Tasks 3, 10, 11. ✅
- Static-base-URL-under-Tethys risk proven → Tasks 11, 12 (curl + browser + per-file 200 checks). ✅
- Testing via `@web/test-runner` → Task 13. ✅
- Phase 1 items (map, model-runs, chart, widgets, theming UI) are intentionally **out of scope**.

**Deliberate deviations from a verbatim port, each justified in place:**
- `client.js` drops the unused `tethysAPI` import (removes a needless circular import) and guards
  `error.response` (the original throws a misleading `TypeError` on any network failure).
- `utilities.js` reads runtime config instead of `process.env`, because no build step substitutes it.

**Placeholder scan:** no TBD/TODO, and no unresolved versions — every CDN URL in Task 2 was fetched
and returned 200 on 2026-08-03, including the Phase 1 ones.

**Ordering note:** Tasks 3–8 are TDD but their tests cannot run until Task 13 exists. Called out in
the task overview, in Task 3 Step 2, and in Task 13's header. Doing Task 13 first is recommended.

**Consistency check:** `createStore`'s `get`/`set`/`subscribe` shape is identical in Tasks 4, 6, 7.
`getConfig()`'s `{ APP_ROOT_URL, PORTAL_HOST }` shape is identical in Tasks 3, 5, 11. `appAPI` method
names match the `@controller` functions in `controllers.py` (verified). `actions.setTheme` /
`setModelRun` match between Tasks 6, 7, and 12. The axios version `0.30.2` is identical in
`DEPENDENCIES.md`, the Task 11 import map, and the installed npm dep.
