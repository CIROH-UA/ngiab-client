import { expect } from '@esm-bundle/chai';
import { actions } from '../store/app-store.js';
import appAPI from '../api/app.js';
import './ngiab-model-runs.js';

// Deleting a run destroys its outputs and cannot be undone, and window.confirm is the only
// thing between a misclick and a user's model output. That guard had no test at all until
// this file: the component's other behaviour is visible the moment you open the page, and
// this one is visible only when it is too late.

function mount() {
  const el = document.createElement('ngiab-model-runs');
  document.body.append(el);
  return el;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ngiab-model-runs', () => {
  let el;
  let realConfirm;
  let realGet;
  let realRemove;
  let removeCalls;

  beforeEach(() => {
    realConfirm = window.confirm;
    realGet = appAPI.getModelRuns;
    realRemove = appAPI.removeModelRun;
    removeCalls = [];

    appAPI.getModelRuns = async () => ({
      model_runs: [
        { value: 'gage-07144100', label: 'gage-07144100' },
        { value: 'preproc-test', label: 'preproc-test' },
      ],
    });
    appAPI.removeModelRun = async (params) => {
      removeCalls.push(params);
      return { removed: params.model_run_id };
    };
  });

  afterEach(() => {
    window.confirm = realConfirm;
    appAPI.getModelRuns = realGet;
    appAPI.removeModelRun = realRemove;
    el?.remove();
    actions.setModelRun(null);
  });

  it('lists the runs it was given, newest first as the server ordered them', async () => {
    el = mount();
    await settle();

    const options = [...el.querySelectorAll('#model-run-select option')];
    expect(options.map((o) => o.value)).to.deep.equal(['gage-07144100', 'preproc-test']);
  });

  it('does not delete when the confirmation is dismissed', async () => {
    window.confirm = () => false;
    el = mount();
    await settle();

    el.querySelector('#model-run-remove').click();
    await settle();

    expect(removeCalls).to.have.length(0);
  });

  it('deletes the selected run when the confirmation is accepted', async () => {
    window.confirm = () => true;
    el = mount();
    await settle();

    el.querySelector('#model-run-select').value = 'preproc-test';
    el.querySelector('#model-run-remove').click();
    await settle();

    expect(removeCalls).to.deep.equal([{ model_run_id: 'preproc-test' }]);
  });

  // It used to promise the opposite, until removal became destructive in the same change.
  it('says the outputs are deleted, because they are', async () => {
    let asked = '';
    window.confirm = (message) => {
      asked = message;
      return false;
    };
    el = mount();
    await settle();

    el.querySelector('#model-run-remove').click();
    await settle();

    expect(asked).to.contain('Delete');
    expect(asked).to.contain('cannot be undone');
    expect(asked).to.not.contain('not deleted');
  });

  it('names the run being deleted, so the wrong one is not confirmed', async () => {
    let asked = '';
    window.confirm = (message) => {
      asked = message;
      return false;
    };
    el = mount();
    await settle();

    el.querySelector('#model-run-select').value = 'preproc-test';
    el.querySelector('#model-run-remove').click();
    await settle();

    expect(asked).to.contain('preproc-test');
  });

  it('offers no importer, because presence in the storage root is registration', async () => {
    el = mount();
    await settle();

    expect(el.querySelector('#model-run-add')).to.equal(null);
    expect(el.querySelector('#model-run-import')).to.equal(null);
  });

  it('tells the user where runs come from when there are none', async () => {
    appAPI.getModelRuns = async () => ({ model_runs: [] });
    el = mount();
    await settle();

    const status = el.querySelector('#model-run-status');
    expect(status.dataset.severity).to.equal('warning');
    expect(status.textContent).to.contain('Copy a run directory');
  });
});
