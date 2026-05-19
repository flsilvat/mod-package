import { Routes, Route } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout.jsx';
import NoAccess from './components/NoAccess.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AircraftPage from './pages/AircraftPage.jsx';
import MaterialsPage from './pages/MaterialsPage.jsx';
import DrawingsPage from './pages/DrawingsPage.jsx';
import ServiceBulletinsPage from './pages/ServiceBulletinsPage.jsx';
import GTLsPage from './pages/GTLsPage.jsx';
import HTLsPage from './pages/HTLsPage.jsx';
import TechnicalOrdersPage from './pages/TechnicalOrdersPage.jsx';
import TOPartViewPage from './pages/TOPartViewPage.jsx';

export default function App() {
  const { user, role, loading } = useAuth();

  // Still working out who is signed in.
  if (loading) {
    return (
      <div className="auth-screen">
        <p className="splash">Loading…</p>
      </div>
    );
  }

  // Not signed in → the login screen.
  if (!user) return <LoginPage />;

  // Signed in but not on the access list → a polite dead end.
  if (role === 'none') return <NoAccess />;

  // Signed in and authorised → the app. New entity pages get added here.
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="aircraft" element={<AircraftPage />} />
        <Route path="materials" element={<MaterialsPage />} />
        <Route path="drawings" element={<DrawingsPage />} />
        <Route path="service-bulletins" element={<ServiceBulletinsPage />} />
        <Route path="gtls" element={<GTLsPage />} />
        <Route path="htls" element={<HTLsPage />} />
        <Route path="technical-orders" element={<TechnicalOrdersPage />} />
        <Route path="to-part/:partId" element={<TOPartViewPage />} />
      </Route>
    </Routes>
  );
}
