# NGIAB frontend (build-less)

Vanilla JS + native Web Components. No bundler. These files are served as-is by Tethys at
`/static/ngiab/app/`. Dependencies are vendored as ESM under `vendor/` and wired via the
import map in `tethysapp/ngiab/templates/ngiab/index.html`.

Source lives here directly — there is no build output. The sibling `../frontend/` directory is
webpack output for the legacy React app and stays gitignored until the Phase 2 cutover deletes it.
