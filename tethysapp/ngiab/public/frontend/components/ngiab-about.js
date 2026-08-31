import { appVersion } from '../config.js';

const LINKS = [
  ['NGIAB Visualizer', 'https://github.com/CIROH-UA/ngiab-client'],
  ['NGIAB CloudInfra', 'https://github.com/CIROH-UA/NGIAB-CloudInfra'],
  ['CIROH', 'https://ciroh.ua.edu'],
];

/**
 * What this app is, which build is running, and where to go next.
 *
 * A disclosure rather than a dialog: nothing here needs to interrupt the task, and the panel
 * is read once. The version is the reason it exists -- it is the first thing a support
 * question needs and the one thing a viewer cannot otherwise find.
 */
export class NgiabAbout extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <details id="about-panel">
        <summary>About this viewer</summary>
        <p class="about-blurb">
          A map and chart view over the outputs of a NextGen In A Box model run. Pick a run,
          select a catchment, and compare its hydrograph against observations.
        </p>
        <p class="about-version">Version <code></code></p>
        <ul class="about-links"></ul>
      </details>
    `;

    const version = appVersion();
    const versionEl = this.querySelector('.about-version');
    if (version) {
      versionEl.querySelector('code').textContent = version;
    } else {
      versionEl.remove();
    }

    const list = this.querySelector('.about-links');
    for (const [label, href] of LINKS) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      link.target = '_blank';
      // noopener: these open in a new tab, and the opened page has no business reaching back.
      link.rel = 'noopener noreferrer';
      item.append(link);
      list.append(item);
    }
  }
}

customElements.define('ngiab-about', NgiabAbout);
