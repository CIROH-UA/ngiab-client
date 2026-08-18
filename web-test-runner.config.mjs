import { puppeteerLauncher } from '@web/test-runner-puppeteer';

// Runs the vanilla frontend's tests as native ES modules in a real browser -- the same
// form the code ships in. No transform step, which is the point: a bundler here would
// reintroduce the build we deleted, and jsdom would not exercise real custom-element
// upgrade semantics.
//
// nodeResolve covers the bare specifiers: `@esm-bundle/chai` in the tests, and `uplot`,
// which the chart imports. uplot is a devDependency pinned to the version in the template's
// import map, so the tests load the same build the browser does. MapLibre and pmtiles are
// never imported by a tested module and stay CDN-only.
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
