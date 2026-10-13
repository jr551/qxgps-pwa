/**
 * Login screen — the only way into the app. Email + password → client.login();
 * on success the session (plus account + login time) goes into the store and
 * the app shell reveals itself.
 *
 * A successful sign-in is kept in this browser (see client.login) until Log out.
 *
 * READ-ONLY SAFETY: the only vendor call on this screen is user.Login via
 * client.login() — no other module.func may be added here.
 */

import { useState } from 'preact/hooks';
import { login, rememberedAccount } from '../api/client';
import { MapiError } from '../api/types';
import { requestAlarmAlerts } from '../alerts';
import { APP_TITLE } from '../brand';
import { setSession, useAppState } from '../state';
import './login.css';

/** localStorage key for the remembered account (email only; never a password). */
const ACCOUNT_KEY = 'qxgps.account';

function loadRememberedAccount(): string {
  try {
    return localStorage.getItem(ACCOUNT_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveRememberedAccount(account: string, remember: boolean): void {
  try {
    if (remember) {
      localStorage.setItem(ACCOUNT_KEY, account);
    } else {
      localStorage.removeItem(ACCOUNT_KEY);
    }
  } catch {
    // Storage unavailable (private mode) — the form still works.
  }
}

/** Login failures show the vendor's own message verbatim. */
function describeError(err: unknown): string {
  if (err instanceof MapiError) {
    return err.error_message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function LoginScreen() {
  const { sessionNotice } = useAppState();
  const [account, setAccount] = useState(() => rememberedAccount() || loadRememberedAccount());
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (): Promise<void> => {
    const email = account.trim();
    if (busy || !email || !password) return;
    requestAlarmAlerts();
    setBusy(true);
    setError(null);
    saveRememberedAccount(email, true);
    try {
      const session = await login(email, password);
      setSession(session, { account: email, loginAt: Date.now() });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login-wrap">
      <section class="card login-card">
        <h1 class="login-title">{APP_TITLE}</h1>
        <p class="card-note">Sign in to your tracker account to continue.</p>
        {sessionNotice ? <p class="login-notice">{sessionNotice}</p> : null}
        <form
          class="stack login-form"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <div class="field">
            <label class="label" for="login-account">
              Account (email)
            </label>
            <input
              id="login-account"
              class="input"
              type="email"
              name="account"
              autocomplete="username"
              placeholder="you@example.com"
              value={account}
              onInput={(e) => setAccount(e.currentTarget.value)}
              disabled={busy}
              required
            />
          </div>
          <div class="field">
            <label class="label" for="login-password">
              Password
            </label>
            <input
              id="login-password"
              class="input"
              type="password"
              name="password"
              autocomplete="current-password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              disabled={busy}
              required
            />
          </div>
          {error ? (
            <p class="error-text" role="alert">
              {error}
            </p>
          ) : null}
          <button class="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p class="card-note">
          This browser keeps you signed in until you log out on the Settings screen.
        </p>
      </section>
    </div>
  );
}
