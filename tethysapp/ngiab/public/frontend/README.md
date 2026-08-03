# NGIAB frontend (build-less)

Vanilla JS + native Web Components. No bundler. These files are served as-is by Tethys at
`/static/ngiab/frontend/`, with `main.js` as the entry module. Dependencies load from the `esm.sh`
CDN at pinned versions — see `DEPENDENCIES.md` — and are wired via the import map in
`tethysapp/ngiab/templates/ngiab/index.html`.

**This directory is hand-authored source and is tracked in git.** It is not build output. The legacy
React app's webpack bundle goes to the sibling `../react-build/` directory, which stays gitignored
until the Phase 2 cutover deletes both it and `reactapp/`.
