import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  resolve: {
    alias: {
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-reconciler': path.resolve(__dirname, 'node_modules/react-reconciler'),
    },
    dedupe: ['react', 'react-dom', 'react-reconciler', 'three'],
  },
});
