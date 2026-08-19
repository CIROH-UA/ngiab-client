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
    const { theme, mapVariable, layers, modelRunId } = store.get();

    // Nothing is drawn without a run, and a key to an empty map explains nothing.
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

  // A strip, not a row per class: eight rows pushed the card stack past the map height.
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

    // A variable that never varies produces one class, and "1 quantile classes" reads as a bug.
    const note =
      entries.length > 1
        ? `${entries.length} quantile classes, this run only`
        : 'constant across every catchment in this run';

    // No units: nothing in the run's config declares them, so inventing one would be a lie.
    this.innerHTML = `
      <div class="legend-title" title="${this._variable}">${this._variable}</div>
      <div class="legend-ramp">${segments}</div>
      <div class="legend-ends">
        <span>${low}</span>
        <span>${high}</span>
      </div>
      <div class="legend-note">${note}</div>
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
