import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import AircraftPage from './pages/AircraftPage.jsx';

// Routes for the app. New entity pages (Materials, Drawings, Service Bulletins,
// ...) get added here as we build them.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="aircraft" element={<AircraftPage />} />
      </Route>
    </Routes>
  );
}
