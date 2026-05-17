import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import App from './App.jsx';
import './index.css';

// HashRouter keeps routing in the URL fragment (e.g. /#/aircraft). This works
// on GitHub Pages with no server config or 404 redirect trick required.
// AuthProvider tracks the signed-in user so the whole app can read it.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AuthProvider>
  </React.StrictMode>
);
