import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import ScopeBar from './ScopeBar';

// Pages where the scope filter is meaningful — Materials, Drawings,
// Service Bulletins, GTLs, HTLs. The scope bar renders just above the page
// body on these routes.
const SCOPED_PATHS = new Set([
  '/materials',
  '/drawings',
  '/service-bulletins',
  '/gtls',
  '/htls',
]);

// Navigation items. As entities are built, add them here. Items marked
// `ready: false` render as disabled placeholders so the roadmap is visible.
const NAV = [
  { to: '/', label: 'Overview', end: true, ready: true },
  { to: '/aircraft', label: 'Aircraft', ready: true },
  { to: '/materials', label: 'Materials', ready: true },
  { to: '/drawings', label: 'Drawings', ready: true },
  { to: '/service-bulletins', label: 'Service Bulletins', ready: true },
  { to: '/gtls', label: 'GTLs', ready: true },
  { to: '/htls', label: 'HTLs', ready: true },
  { to: '/technical-orders', label: 'Technical Orders', ready: true },
  { to: '/projects', label: 'Projects', ready: true },
];

export default function Layout() {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  const showScope = SCOPED_PATHS.has(location.pathname);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <span className="brand-name">MOD&nbsp;PACKAGE</span>
          <span className="brand-sub">technical order builder</span>
        </div>

        <div className="topbar-right">
          <nav className="nav" aria-label="Sections">
            {NAV.map((item) =>
              item.ready ? (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    'nav-link' + (isActive ? ' is-active' : '')
                  }
                >
                  {item.label}
                </NavLink>
              ) : (
                <span
                  key={item.to}
                  className="nav-link is-pending"
                  title="Coming soon"
                >
                  {item.label}
                </span>
              )
            )}
          </nav>

          <div className="user-chip">
            <span className="user-email" title={user?.email}>
              {user?.email}
            </span>
            <span className={'role-badge role-' + role}>{role}</span>
            <button className="signout" onClick={logout} title="Sign out">
              ⏻
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        {showScope && <ScopeBar />}
        <Outlet />
      </main>

      <footer className="footer">
        <span>Mod Package · internal tooling</span>
        <span className="footer-build">v0.19.6 · pdf alt chips in kit list</span>
      </footer>
    </div>
  );
}
