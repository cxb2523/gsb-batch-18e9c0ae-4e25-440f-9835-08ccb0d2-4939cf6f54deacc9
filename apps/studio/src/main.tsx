import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocalApp } from './local/LocalApp';
import './styles.css';

// Local mode only when the prismbox daemon served this page (it adds the marker to index.html). On a static host there is
// no daemon, nothing is probed, and the Playground runs with no local-mode UI at all.
const local = document.querySelector('meta[name="prismbox-local"]') !== null;
createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode>{local ? <LocalApp /> : <App />}</StrictMode>);
