# NGIAB frontend (build-less)

Vanilla JS + native Web Components. No bundler. These files are served as-is by Tethys at
`/static/ngiab/frontend/`. Dependencies are vendored as ESM under `vendor/` and wired via the
import map in `tethysapp/ngiab/templates/ngiab/index.html`.
