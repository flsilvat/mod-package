import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' makes all asset paths relative, so the build works whatever the
// GitHub Pages repo name is. Combined with HashRouter, no extra config is needed.
export default defineConfig({
  plugins: [react()],
  base: './',
});
