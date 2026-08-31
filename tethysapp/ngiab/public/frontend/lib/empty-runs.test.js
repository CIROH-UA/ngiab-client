import { expect } from '@esm-bundle/chai';
import { noRunsMessage } from './empty-runs.js';

describe('noRunsMessage', () => {
  it('names uploading to someone who can upload', () => {
    expect(noRunsMessage(true)).to.contain('Upload a run archive');
  });

  it('does not offer uploading to someone who cannot', () => {
    expect(noRunsMessage(false)).to.not.contain('Upload');
  });

  it('always says how a run gets there, whichever way that is', () => {
    for (const canUpload of [true, false]) {
      expect(noRunsMessage(canUpload)).to.contain('No model runs yet');
      expect(noRunsMessage(canUpload)).to.match(/run directory/);
    }
  });

  // The first version composed both variants from one shared clause and produced
  // "once someone copy a run directory ... and it will appear here".
  it('reads as sentences, not as a clause glued to a stem', () => {
    for (const canUpload of [true, false]) {
      const message = noRunsMessage(canUpload);
      expect(message, message).to.not.match(/someone copy/);
      expect((message.match(/appear/g) || []).length, message).to.be.at.most(1);
      expect(message.trim().endsWith('.'), message).to.equal(true);
    }
  });
});
