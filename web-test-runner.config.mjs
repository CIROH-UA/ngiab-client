import { puppeteerLauncher } from '@web/test-runner-puppeteer';

// Runs the vanilla frontend's tests as native ES modules in a real browser -- the same
// form the code ships in. No transform step, which is the point: a bundler here would
// reintroduce the build we deleted, and jsdom would not exercise real custom-element
// upgrade semantics.
//
// nodeResolve is only needed for the bare `@esm-bundle/chai` specifier in the tests. The
// application code itself imports nothing bare: MapLibre and pmtiles come from the CDN via
// the template's import map, and the API layer uses native fetch.
//
// The puppeteer launcher is used instead of the default chromeLauncher because the latter
// cannot start a page under WSL2 ("browser was unable to create and start a test page").
// Puppeteer ships its own Chromium and needs --no-sandbox in a container/WSL environment.
export default {
  nodeResolve: true,
  files: ['tethysapp/ngiab/public/frontend/**/*.test.js'],
  browsers: [
    puppeteerLauncher({
      launchOptions: {
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      },
    }),
  ],
};
