import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import BattlefieldPreview from './BattlefieldPreview';
import './styles/index.css';

const isPreview = window.location.search.includes('preview');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPreview ? <BattlefieldPreview /> : <App />}
  </React.StrictMode>,
);