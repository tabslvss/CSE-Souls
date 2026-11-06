import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Divider, Panel, Sigil } from '../components/Ornaments';
import { HeroScene } from '../scene/HeroScene';
import { useSession } from '../session';
import { sound } from '../sound';

const WELCOME_MS = 1400;
const BREACH_CHECK_DELAY_MS = 500;

/** Only same-site paths, so a crafted ?next= link can't send someone to another site. */
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/')) return '/';
  try {
    // URL parsing ignores tabs and newlines, so "/\t/evil.example" is judged the way a browser reads it.
    const parsed = new URL(next, window.location.origin);
    if (parsed.origin !== window.location.origin || parsed.pathname.startsWith('//')) return '/';
    return parsed.pathname + parsed.search;
  } catch {
    return '/';
  }
}

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="auth">
      <HeroScene className="auth__scene" intensity={0.8} artName="auth-background" />
      <div className="auth__veil" />
      <Panel className="auth__panel">
        <Sigil className="auth__sigil" />
        <h1>{title}</h1>
        <p className="auth__subtitle">{subtitle}</p>
        <Divider />
        {children}
      </Panel>
    </section>
  );
}

function Welcome({ name }: { name: string }) {
  return (
    <div className="welcome" role="status">
      <p className="welcome__label">Welcome,</p>
      <p className="welcome__name">{name}</p>
    </div>
  );
}

function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>Password</label>
      <div className="field__with-action">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          required
        />
        <button type="button" className="field__action" onClick={() => setShown(!shown)}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

function useAuthForm(action: (username: string, password: string) => Promise<void>, destination?: string) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcomed, setWelcomed] = useState<string | null>(null);
  const next = destination ?? safeNextPath(params.get('next'));

  // Someone who is already logged in has no reason to be on this page.
  useEffect(() => {
    if (!loading && user && !welcomed && !busy) navigate(next, { replace: true });
  }, [loading, user, welcomed, busy, navigate, next]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action(username.trim(), password);
      setWelcomed(username.trim());
      sound.play('ignite');
      window.setTimeout(() => navigate(next, { replace: true }), WELCOME_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      sound.play('error');
      setBusy(false);
    }
  };

  return { username, setUsername, password, setPassword, error, busy, welcomed, submit };
}

export function LoginPage() {
  const { login } = useSession();
  const form = useAuthForm(login);
  const [params] = useSearchParams();
  const nextQuery = params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : '';

  return (
    <AuthFrame title="Log In" subtitle="Welcome back.">
      {form.welcomed && <Welcome name={form.welcomed} />}
      <form onSubmit={form.submit} className="form">
        <div className="field">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            value={form.username}
            onChange={(event) => form.setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <PasswordField id="login-password" value={form.password} onChange={form.setPassword} autoComplete="current-password" />
        {form.error && <p className="form__error" role="alert">{form.error}</p>}
        <button className="btn btn--primary btn--block" disabled={form.busy}>
          {form.busy ? 'Logging in…' : 'Log In'}
        </button>
      </form>
      <p className="auth__switch">
        New here? <Link to={`/register${nextQuery}`}>Create an account</Link>
      </p>
    </AuthFrame>
  );
}

const PASSWORD_RULES: Array<[string, (password: string) => boolean]> = [
  ['At least 8 characters', (p) => p.length >= 8],
  ['A lowercase letter', (p) => /[a-z]/.test(p)],
  ['An uppercase letter', (p) => /[A-Z]/.test(p)],
  ['A number', (p) => /[0-9]/.test(p)],
  ['A special character', (p) => /[^A-Za-z0-9]/.test(p)],
];

/**
 * Asks Have I Been Pwned whether this password has leaked in a data breach. Only the first
 * 5 characters of its SHA-1 hash leave the browser, so the service never learns the password.
 * Any failure just means no warning: this check must never get in the way of signing up.
 */
function useBreachCount(password: string, enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    // crypto.subtle only exists on HTTPS and localhost.
    if (!enabled || !crypto.subtle) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
        const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
        const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
          signal: controller.signal,
          credentials: 'omit',
        });
        if (!response.ok) return;
        const match = (await response.text())
          .split('\n')
          .find((line) => line.startsWith(hash.slice(5)));
        setCount(match ? Number(match.split(':')[1]) || 0 : 0);
      } catch {
        // No connection, or the password changed while this was running.
      }
    }, BREACH_CHECK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [password, enabled]);

  return count;
}

export function RegisterPage() {
  const { register } = useSession();
  // A brand-new account always goes straight to creating a character.
  const form = useAuthForm(register, '/create');
  const [params] = useSearchParams();
  const nextQuery = params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : '';
  const usernameValid = /^[A-Za-z0-9]{3,20}$/.test(form.username);
  const passwordValid = PASSWORD_RULES.every(([, test]) => test(form.password));
  const breachCount = useBreachCount(form.password, passwordValid);

  return (
    <AuthFrame title="Create Account" subtitle="Your username will show above your character in the game.">
      {form.welcomed && <Welcome name={form.welcomed} />}
      <form onSubmit={form.submit} className="form">
        <div className="field">
          <label htmlFor="register-username">Username</label>
          <input
            id="register-username"
            value={form.username}
            onChange={(event) => form.setUsername(event.target.value)}
            autoComplete="username"
            maxLength={20}
            aria-describedby="username-hint"
            autoFocus
            required
          />
          <p id="username-hint" className="field__hint">3 to 20 letters or numbers.</p>
        </div>
        <PasswordField
          id="register-password"
          value={form.password}
          onChange={form.setPassword}
          autoComplete="new-password"
          describedBy="password-rules"
        />
        <ul id="password-rules" className="rules">
          {PASSWORD_RULES.map(([label, test]) => (
            <li key={label} data-met={test(form.password)}>{label}</li>
          ))}
        </ul>
        {breachCount > 0 && (
          <p className="form__warning" role="status">
            This password has appeared in {breachCount.toLocaleString()} known data breaches. You can
            still use it, but a different one would be safer.
          </p>
        )}
        {form.error && <p className="form__error" role="alert">{form.error}</p>}
        <button className="btn btn--primary btn--block" disabled={form.busy || !usernameValid || !passwordValid}>
          {form.busy ? 'Creating account…' : 'Create Account'}
        </button>
      </form>
      <p className="auth__switch">
        Already have an account? <Link to={`/login${nextQuery}`}>Log in</Link>
      </p>
    </AuthFrame>
  );
}
