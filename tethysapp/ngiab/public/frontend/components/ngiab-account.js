import { isSignedIn, loginUrl, logoutUrl, userName } from '../config.js';

/**
 * Sign in and out from inside the app.
 *
 * The page is a standalone document rather than a portal template, so no portal chrome
 * surrounds it in either single-app or multi-app mode and this is the only account control a
 * viewer has. Both URLs are portal-level and absolute, so they are the same in both.
 */
export class NgiabAccount extends HTMLElement {
  connectedCallback() {
    const signedIn = isSignedIn();
    this.dataset.state = signedIn ? 'signed-in' : 'guest';

    this.innerHTML = `
      <p class="account-note"></p>
      <a class="pill account-action"></a>
    `;

    const action = this.querySelector('.account-action');
    action.id = signedIn ? 'account-sign-out' : 'account-sign-in';
    action.href = signedIn ? logoutUrl() : loginUrl();
    action.textContent = signedIn ? 'Sign out' : 'Sign in';

    const note = this.querySelector('.account-note');
    if (!signedIn) {
      note.textContent = 'Read-only: uploading and deleting need an account.';
      return;
    }
    note.append('Signed in as ');
    const who = document.createElement('span');
    who.className = 'account-name';
    who.textContent = userName() || 'your account';
    note.append(who);
  }
}

customElements.define('ngiab-account', NgiabAccount);
