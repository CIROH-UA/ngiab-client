import { expect } from '@esm-bundle/chai';
import { actions } from '../store/app-store.js';
import appAPI from '../api/app.js';
import { noRunsMessage } from '../lib/empty-runs.js';
import './ngiab-model-runs.js';


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
    // Deleting is offered only to someone who can complete it, so the tests that exercise
    // the control have to be that someone.
    window.__NGIAB__ = { SIGNED_IN: true, CAN_DELETE: true };
  });

  afterEach(() => {
    delete window.__NGIAB__;
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

  describe('the delete control', () => {
    afterEach(() => { delete window.__NGIAB__; });

    it('is hidden from a signed-in user who lacks the permission', async () => {
      window.__NGIAB__ = { SIGNED_IN: true, CAN_DELETE: false };
      el = mount();
      await settle();

      expect(el.querySelector('#model-run-remove')).to.equal(null);
    });

    it('is shown to a signed-in user who has it', async () => {
      window.__NGIAB__ = { SIGNED_IN: true, CAN_DELETE: true };
      el = mount();
      await settle();

      expect(el.querySelector('#model-run-remove')).to.not.equal(null);
    });

    // It used to stay visible for a guest so the 401 would lead them to a login page. That
    // offered an irreversible action to someone who could not complete it, and the account
    // row now carries the sign-in prompt instead.
    it('is hidden from a guest, who has the account row to sign in with', async () => {
      window.__NGIAB__ = { SIGNED_IN: false, CAN_DELETE: false };
      el = mount();
      await settle();

      expect(el.querySelector('#model-run-remove')).to.equal(null);
    });

    it('does not break the empty-state path when it is absent', async () => {
      window.__NGIAB__ = { SIGNED_IN: true, CAN_DELETE: false };
      appAPI.getModelRuns = async () => ({ model_runs: [] });
      el = mount();
      await settle();

      expect(el.querySelector('#model-run-status').dataset.severity).to.equal('warning');
    });
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
    // The shared message, so this panel and the card over the map cannot disagree about
    // what to do next. noRunsMessage owns the wording; empty-runs.test.js owns the variants.
    expect(status.textContent).to.equal(noRunsMessage(true));
  });
});
