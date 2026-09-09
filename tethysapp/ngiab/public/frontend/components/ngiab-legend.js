import { store } from '../store/app-store.js';
import { legendEntries, legendLabel } from '../lib/choropleth.js';
import { PLAIN_FILL, TEEHR_FILL } from './map/layers.js';

export class NgiabLegend extends HTMLElement {
  connectedCallback() {
    this._breaks = [];
    this._variable = null;
    this._unsubscribe = store.subscribe(() => this.render());
    this.render();
  }

  disconnectedCallback() {
    this._unsubscribe?.();
  }

  setScale({ variable, breaks }) {
    this._variable = variable ?? null;
    this._breaks = Array.isArray(breaks) ? breaks : [];
    this.render();
  }

  render() {
    const { theme, mapVariable, layers, modelRunId } = store.get();

    const key = JSON.stringify([
      theme, mapVariable, layers.showTeehr, modelRunId,
      this._variable, this._breaks, this._teehrCount,
    ]);
    if (key === this._renderedKey) return;
    this._renderedKey = key;

    if (!modelRunId) {
      this.innerHTML = '';
      return;
    }

    if (mapVariable && this._variable) this._renderGraduated(theme);
    else this._renderCategorical(theme, layers.showTeehr);
  }

  setTeehrCount(count) {
    this._teehrCount = count;
    this.render();
  }

  _renderGraduated(theme) {
    const entries = legendEntries(this._breaks, theme);
    const segments = entries
      .map(
        (entry) =>
          `<span class="seg" style="background:${entry.color}" title="${legendLabel(entry)}"></span>`,
      )
      .join('');

    const low = entries.length ? legendLabel(entries[0]) : '';
    const high = entries.length > 1 ? legendLabel(entries[entries.length - 1]) : '';

    const note =
      entries.length > 1
        ? `${entries.length} quantile classes, this run only`
        : 'constant across every catchment in this run';

    this.innerHTML = `
      <div class="legend-title"></div>
      <div class="legend-ramp">${segments}</div>
      <div class="legend-ends">
        <span>${low}</span>
        <span>${high}</span>
      </div>
      <div class="legend-note">${note}</div>
    `;

    const title = this.querySelector('.legend-title');
    title.textContent = this._variable;
    title.title = this._variable;
  }

  _renderCategorical(theme, showTeehr) {
    const teehr = TEEHR_FILL[theme] ?? TEEHR_FILL.light;
    const plain = PLAIN_FILL[theme] ?? PLAIN_FILL.light;

    const rows = [
      showTeehr && this._teehrCount
        ? `<li><span class="swatch" style="background:${teehr}"></span><span class="label">has TEEHR results</span></li>`
        : '',
      `<li><span class="swatch" style="background:${plain}"></span><span class="label">in this model run</span></li>`,
      '<li><span class="swatch swatch-selected"></span><span class="label">selected</span></li>',
    ].join('');

    this.innerHTML = `<ul class="legend-scale">${rows}</ul>`;
  }
}

customElements.define('ngiab-legend', NgiabLegend);
