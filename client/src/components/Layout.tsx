import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { sound } from '../sound';
import { Avatar } from './Avatar';
import { Sigil } from './Ornaments';
import { Toasts } from './toast';

export const TEAM = ['Tabshir Khandaker', 'Kristian Schuchman', 'Ryan Chan'];

function useSoundEnabled(): boolean {
  return useSyncExternalStore(
    (notify) => sound.subscribe(notify),
    () => sound.enabled,
  );
}

function SoundToggle() {
  const enabled = useSoundEnabled();
  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={enabled}
      aria-label="Music and sound effects"
      onClick={() => sound.setEnabled(!enabled)}
      title={enabled ? 'Turn music and sound effects off' : 'Turn music and sound effects on'}
    >
      <svg className="sound-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9.500v5h3.500L12 19V5L6.500 9.500Z" fill="currentColor" />
        {enabled ? (
          <path d="M15 9a4.200 4.200 0 0 1 0 6M17.500 6.500a7.800 7.800 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.600" />
        ) : (
          <path d="m15.500 9.500 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.600" />
        )}
      </svg>
      <span>{enabled ? 'Sound on' : 'Sound off'}</span>
    </button>
  );
}

function AccountArea() {
  const { user, loading, logout } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState(false);

  if (loading) return <div className="account account--pending" />;

  if (!user) {
    return (
      <div className="account">
        <Link className="btn btn--ghost btn--small" to="/login">Log In</Link>
        <Link className="btn btn--primary btn--small" to="/register">Sign Up</Link>
      </div>
    );
  }

  const onLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch {
      setError(true);
    }
  };

  return (
    <div className="account">
      <Link className="account__who" to="/character" title="View your character">
        <Avatar url={user.avatarUrl} name={user.username} size={36} />
        <span className="account__text">
          <span className="account__label">Logged in as</span>
          <span className="account__name">{user.username}</span>
        </span>
      </Link>
      <button type="button" className="btn btn--ghost btn--small" onClick={onLogout}>
        {error ? 'Try again' : 'Log Out'}
      </button>
    </div>
  );
}

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/play', label: 'Play' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/achievements', label: 'Achievements' },
];

export function Layout() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      window.scrollTo(0, 0);
      sound.play('page');
    }
    const atTheFire = pathname === '/login' || pathname === '/register' || pathname === '/play';
    sound.setAmbience(atTheFire ? 'fire' : 'wind');
  }, [pathname]);

  return (
    <div className="site">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="topbar" aria-label="Main">
        <Link className="brand" to="/" aria-label="CSE Souls home">
          <Sigil />
          <span className="brand__word">CSE Souls</span>
        </Link>
        <div className="topbar__links">
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className="topbar__link">
              {link.label}
            </NavLink>
          ))}
        </div>
        <div className="topbar__right">
          <SoundToggle />
          <AccountArea />
        </div>
      </nav>

      <main id="main">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="footer__brand">
          <Sigil />
          <div>
            <p className="footer__word">CSE Souls</p>
            <p className="footer__note">
              Made by {TEAM[0]}, {TEAM[1]} and {TEAM[2]}.
              <br />
              CSE 312 team project, University at Buffalo.
            </p>
          </div>
        </div>
        <ul className="footer__links">
          <li><Link to="/leaderboard">Leaderboard</Link></li>
          <li><Link to="/achievements">Achievements</Link></li>
          <li><Link to="/credits">Credits</Link></li>
        </ul>
      </footer>
      <Toasts />
    </div>
  );
}
