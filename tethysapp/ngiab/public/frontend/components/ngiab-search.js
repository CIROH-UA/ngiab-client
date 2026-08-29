import { searchCatchments } from '../lib/ids.js';

export class NgiabSearch extends HTMLElement {
  connectedCallback() {
    this._index = this._index ?? [];
    this._hasTeehr = this._hasTeehr ?? (() => false);

    this._matches = [];
    this._activeIndex = -1;
    this._noMatches = false;

    this._input = this.querySelector('#map-search');
    this._clear = this.querySelector('#map-search-clear');
    this._results = this.querySelector('#map-search-results');
    this._empty = this.querySelector('#map-search-empty');

    if (!this._input) return;

    this._onInput = () => {
      this._matches = searchCatchments(this._index, this._input.value);
      this._activeIndex = this._matches.length ? 0 : -1;
      this._noMatches = Boolean(this._input.value.trim()) && this._matches.length === 0;
      this._clear.hidden = !this._input.value;
      this._render();
    };

    this._onKeyDown = (event) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this._move(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          this._move(-1);
          break;
        case 'Enter':
          event.preventDefault();
          this._choose(this._activeIndex >= 0 ? this._activeIndex : 0);
          break;
        case 'Escape':
          this._close();
          break;
        default:
          break;
      }
    };

    this._onFocus = () => {
      if (this._input.value.trim() && !this._matches.length) this._onInput();
    };
    this._onBlur = () => this._close();
    this._onClear = () => {
      this._input.value = '';
      this._clear.hidden = true;
      this._close();
      this._input.focus();
    };

    this._input.addEventListener('input', this._onInput);
    this._input.addEventListener('keydown', this._onKeyDown);
    this._input.addEventListener('focus', this._onFocus);
    this._input.addEventListener('blur', this._onBlur);
    this._clear?.addEventListener('click', this._onClear);
  }

  disconnectedCallback() {
    this._input?.removeEventListener('input', this._onInput);
    this._input?.removeEventListener('keydown', this._onKeyDown);
    this._input?.removeEventListener('focus', this._onFocus);
    this._input?.removeEventListener('blur', this._onBlur);
    this._clear?.removeEventListener('click', this._onClear);
  }

  setIndex(index, hasTeehr) {
    this._index = index ?? [];
    if (hasTeehr) this._hasTeehr = hasTeehr;
    this._close();
    if (this._input) this._input.value = '';
    if (this._clear) this._clear.hidden = true;
  }

  _render() {
    this._results.textContent = '';

    this._matches.forEach((entry, i) => {
      const li = document.createElement('li');
      li.id = `map-search-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === this._activeIndex));

      const id = document.createElement('span');
      id.className = 'id';
      id.textContent = entry.label;
      li.append(id);

      if (this._hasTeehr(entry.numeric)) {
        const badge = document.createElement('span');
        badge.className = 'teehr';
        badge.textContent = 'TEEHR';
        li.append(badge);
      }

      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this._choose(i);
      });
      this._results.append(li);
    });

    const open = this._matches.length > 0;
    this._results.hidden = !open;
    this._empty.hidden = !this._noMatches;
    this._input.setAttribute('aria-expanded', String(open));

    if (this._activeIndex >= 0) {
      this._input.setAttribute('aria-activedescendant', `map-search-opt-${this._activeIndex}`);
      this._results.children[this._activeIndex]?.scrollIntoView({ block: 'nearest' });
    } else {
      this._input.removeAttribute('aria-activedescendant');
    }
  }

  _close() {
    this._matches = [];
    this._activeIndex = -1;
    this._noMatches = false;
    if (this._results) this._render();
  }

  _choose(index) {
    const entry = this._matches[index];
    if (!entry) return;

    this._input.value = entry.label;
    this._close();
    this.dispatchEvent(
      new CustomEvent('catchment-selected', {
        detail: { numeric: entry.numeric, label: entry.label },
        bubbles: true,
      }),
    );
  }

  _move(delta) {
    if (!this._matches.length) return;
    this._activeIndex = (this._activeIndex + delta + this._matches.length) % this._matches.length;
    this._render();
  }
}

customElements.define('ngiab-search', NgiabSearch);
