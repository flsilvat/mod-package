import { NavLink, Outlet } from 'react-router-dom';

// Navigation items. As entities are built, add them here. Items marked
// `ready: false` render as disabled placeholders so the roadmap is visible.
const NAV = [
  { to: '/', label: 'Overview', end: true, ready: true },
  { to: '/aircraft', label: 'Aircraft', ready: true },
  { to: '/materials', label: 'Materials', ready: false },
  { to: '/drawings', label: 'Drawings', ready: false },
  { to: '/service-bulletins', label: 'Service Bulletins', ready: false },
  { to: '/technical-orders', label: 'Technical Orders', ready: false },
];

export default function Layout() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <span className="brand-name">MOD&nbsp;PACKAGE</span>
          <span className="brand-sub">technical order builder</span>
        </div>
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
              <span key={item.to} className="nav-link is-pending" title="Coming soon">
                {item.label}
              </span>
            )
          )}
        </nav>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <footer className="footer">
        <span>Mod Package · internal tooling</span>
        <span className="footer-build">v0.1 · foundation</span>
      </footer>
    </div>
  );
}
