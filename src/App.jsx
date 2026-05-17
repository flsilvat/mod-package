import { Routes, Route } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout.jsx';
import NoAccess from './components/NoAccess.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AircraftPage from './pages/AircraftPage.jsx';

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
      </Route>
    </Routes>
  );
}
