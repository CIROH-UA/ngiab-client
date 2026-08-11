import { store } from '../store/app-store.js';
import { legendEntries, legendLabel } from '../lib/choropleth.js';

// Explains whatever the catchment colours currently mean. Without it the map is decorative.
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
    const { theme, mapVariable, layers } = store.get();
    if (mapVariable && this._variable) this._renderGraduated(theme);
    else this._renderCategorical(theme, layers.showTeehr);
  }

  setTeehrCount(count) {
    this._teehrCount = count;
    this.render();
  }

  // A continuous strip rather than one row per class: eight stacked rows pushed the whole
  // card stack past the height of the map. Each segment keeps its own tooltip, so the exact
  // range of any class is still one hover away.
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

    // No units: nothing in the run's config declares them, so inventing one would be a lie.
    this.innerHTML = `
      <div class="legend-title" title="${this._variable}">${this._variable}</div>
      <div class="legend-ramp">${segments}</div>
      <div class="legend-ends">
        <span>${low}</span>
        <span>${high}</span>
      </div>
      <div class="legend-note">${entries.length} quantile classes, this run only</div>
    `;
  }

  _renderCategorical(theme, showTeehr) {
    const teehr = theme === 'dark' ? 'rgba(32, 201, 151, 0.55)' : 'rgba(31, 120, 180, 0.55)';
    const plain = theme === 'dark' ? 'rgba(238, 51, 119, 0.32)' : 'rgba(91, 44, 111, 0.32)';

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
