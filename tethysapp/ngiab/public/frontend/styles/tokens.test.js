import { expect } from '@esm-bundle/chai';


const CSS = new URL('./tokens.css', import.meta.url);

const EXPLICIT_DARK = ':root[data-theme="dark"]';
const SYSTEM_DARK = ':root:not([data-theme="light"])';
const FLOOR = 4.5;
const TEXT_ROLES = ['--fg', '--fg-muted', '--fg-subtle', '--accent', '--danger', '--warning'];

let source;
before(async () => {
  source = await (await fetch(CSS)).text();
});

function declarations(selector) {
  const at = source.indexOf(selector);
  if (at === -1) throw new Error(`${selector} not found in tokens.css`);
  const body = source
    .slice(source.indexOf('{', at) + 1, source.indexOf('}', at))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Map();
  for (const line of body.split(';')) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    const name = line.slice(0, at).trim();
    if (name.startsWith('--')) found.set(name, line.slice(at + 1).trim());
  }
  return found;
}

function srgb(value) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = '#000';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function luminance(value) {
  const [r, g, b] = srgb(value).map((n) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function resolve(value) {
  return value;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('tokens.css dark palette', () => {
  it('declares the same tokens under the toggle and the system preference', () => {
    const explicit = declarations(EXPLICIT_DARK);
    const system = declarations(SYSTEM_DARK);

    expect([...system.keys()].sort()).to.deep.equal([...explicit.keys()].sort());
  });

  it('gives them the same values, so the two paths cannot diverge', () => {
    const explicit = declarations(EXPLICIT_DARK);
    const system = declarations(SYSTEM_DARK);

    for (const [name, value] of explicit) {
      expect(system.get(name), `${name} differs between the dark blocks`).to.equal(value);
    }
  });
});

describe('tokens.css contrast', () => {
  it('measures a known pair correctly, so a 1:1 result means a broken probe', () => {
    expect(ratio(resolve('#000'), resolve('#fff'))).to.be.closeTo(21, 0.1);
  });

  for (const [theme, selector] of [['light', ':root'], ['dark', EXPLICIT_DARK]]) {
    it(`holds every text role at or above ${FLOOR}:1 in ${theme}`, () => {
      const tokens = declarations(selector);
      const light = declarations(':root');
      const surface = resolve(tokens.get('--surface') ?? light.get('--surface'));

      for (const role of TEXT_ROLES) {
        const declared = tokens.get(role) ?? light.get(role);
        if (!declared) continue;
        const measured = ratio(resolve(declared), surface);
        expect(measured, `${role} in ${theme} is ${measured.toFixed(2)}:1`).to.be.at.least(FLOOR);
      }
    });
  }
});
