import { expect } from '@esm-bundle/chai';
import appAPI from '../api/app.js';
import transfer from '../lib/upload.js';
import './ngiab-upload-run.js';

// The upload panel's job is to keep a three-step transfer legible: reserve, send, wait. The
// waiting is the part worth testing -- unpacking outlives the request that starts it, so the
// outcome only ever arrives by polling, and a poll that stops early looks like a hung upload.

function mount() {
  const el = document.createElement('ngiab-upload-run');
  document.body.append(el);
  return el;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function file(name = 'gage-99.tar.gz') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'application/gzip' });
}

// The panel reads .files, which cannot be assigned; a DataTransfer builds a real FileList.
function attach(el, f) {
  const dt = new DataTransfer();
  dt.items.add(f);
  el.querySelector('#upload-file').files = dt.files;
}

describe('ngiab-upload-run', () => {
  let el;
  let real;
  let realTransfer;

  beforeEach(() => {
    real = { ...appAPI };
    realTransfer = { ...transfer };
    // No server here to receive the bytes; these tests are about the steps around them.
    transfer.putPresigned = async () => ({ status: 200 });
    transfer.postToPortal = async () => ({ status: 200 });
    window.__NGIAB__ = { CAN_UPLOAD: true, SIGNED_IN: true };
  });

  afterEach(() => {
    Object.assign(appAPI, real);
    Object.assign(transfer, realTransfer);
    el?.remove();
    delete window.__NGIAB__;
  });

  it('renders nothing at all without the permission', async () => {
    window.__NGIAB__ = { CAN_UPLOAD: false, SIGNED_IN: true };
    el = mount();
    await settle();

    expect(el.querySelector('#upload-start')).to.equal(null);
  });

  it('renders the panel with the permission', async () => {
    el = mount();
    await settle();

    expect(el.querySelector('#upload-start')).to.not.equal(null);
  });

  it('suggests the run name from the archive filename', async () => {
    el = mount();
    await settle();

    attach(el, file('gage-07144100.tar.gz'));
    el.querySelector('#upload-file').dispatchEvent(new Event('change'));
    expect(el.querySelector('#upload-name').value).to.equal('gage-07144100');
  });

  it('will not start without a name', async () => {
    let called = false;
    appAPI.createUpload = async () => { called = true; return {}; };
    el = mount();
    await settle();

    el.querySelector('#upload-start').click();
    await settle();

    expect(called).to.equal(false);
    expect(el.querySelector('#upload-status').dataset.severity).to.equal('warning');
  });

  it('will not start without a file', async () => {
    let called = false;
    appAPI.createUpload = async () => { called = true; return {}; };
    el = mount();
    await settle();

    el.querySelector('#upload-name').value = 'gage-99';
    el.querySelector('#upload-start').click();
    await settle();

    expect(called).to.equal(false);
  });

  it('reports a refusal from the server instead of uploading anyway', async () => {
    appAPI.createUpload = async () => {
      const error = new Error('taken');
      error.userMessage = 'A run called gage-99 already exists.';
      throw error;
    };
    el = mount();
    await settle();

    el.querySelector('#upload-name').value = 'gage-99';
    attach(el, file());
    el.querySelector('#upload-start').click();
    await settle();
    await settle();

    const status = el.querySelector('#upload-status');
    expect(status.dataset.severity).to.equal('error');
    expect(status.textContent).to.contain('already exists');
  });

  it('announces the run once unpacking finishes, so the picker can refresh', async () => {
    appAPI.createUpload = async () => ({ job: 'a'.repeat(32), mode: 'direct', name: 'gage-99' });
    appAPI.uploadRunUrl = () => '/uploadRun/';
    let polls = 0;
    appAPI.uploadStatus = async () => {
      polls += 1;
      return polls < 2
        ? { state: 'running', stage: 'converting', message: 'converting', terminal: false }
        : { state: 'done', stage: 'done', message: 'ready', run: 'gage-99', terminal: true };
    };

    el = mount();
    await settle();
    let announced = null;
    document.addEventListener('run-published', (e) => { announced = e.detail.run; });

    el.querySelector('#upload-name').value = 'gage-99';
    attach(el, file());
    el.querySelector('#upload-start').click();

    // Two polls at 2s apiece; the fake transfer resolves immediately.
    await new Promise((resolve) => setTimeout(resolve, 4600));
    expect(polls).to.be.greaterThan(1);
    expect(announced).to.equal('gage-99');
  }).timeout(10000);

  it('keeps polling past a non-terminal status rather than declaring success', async () => {
    appAPI.createUpload = async () => ({ job: 'b'.repeat(32), mode: 'direct', name: 'g' });
    appAPI.uploadRunUrl = () => '/uploadRun/';
    appAPI.uploadStatus = async () => (
      { state: 'running', stage: 'converting', message: 'still going', terminal: false }
    );

    el = mount();
    await settle();
    let announced = false;
    document.addEventListener('run-published', () => { announced = true; });

    el.querySelector('#upload-name').value = 'g';
    attach(el, file());
    el.querySelector('#upload-start').click();
    await new Promise((resolve) => setTimeout(resolve, 4600));

    expect(announced).to.equal(false);
    expect(el.querySelector('#upload-status').textContent).to.contain('still going');
  }).timeout(10000);

  it('surfaces a failed job as an error rather than silence', async () => {
    appAPI.createUpload = async () => ({ job: 'c'.repeat(32), mode: 'direct', name: 'g' });
    appAPI.uploadRunUrl = () => '/uploadRun/';
    appAPI.uploadStatus = async () => (
      { state: 'failed', stage: 'failed', message: 'No realization.json in the archive.',
        terminal: true }
    );

    el = mount();
    await settle();
    el.querySelector('#upload-name').value = 'g';
    attach(el, file());
    el.querySelector('#upload-start').click();
    await new Promise((resolve) => setTimeout(resolve, 2600));

    const status = el.querySelector('#upload-status');
    expect(status.dataset.severity).to.equal('error');
    expect(status.textContent).to.contain('realization.json');
  }).timeout(10000);
});
