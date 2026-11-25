import { useState } from 'react';
import Hero3D from './Hero3D';

declare global {
  interface Window {
    __ctaClicks?: number;
  }
}

export default function App() {
  const [started, setStarted] = useState(false);
  return (
    <div className="page">
      <div className="hero-canvas" aria-hidden="true">
        <Hero3D />
      </div>

      <header className="nav">
        <a className="logo" href="#top">
          <span className="logo-mark" /> Meridian
        </a>
        <nav>
          <a href="#payments">Payments</a>
          <a href="#treasury">Treasury</a>
          <a href="#developers">Developers</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <button className="btn ghost" type="button">Sign in</button>
      </header>

      <main className="hero-copy" id="top">
        <p className="eyebrow">Money infrastructure</p>
        <h1>
          Move money at the <span className="grad">speed of software</span>.
        </h1>
        <p className="lede">
          One API for accounts, cards and payouts in 40 countries. Settle in minutes, reconcile in real time, and stop
          stitching together five vendors.
        </p>
        <div className="actions">
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              window.__ctaClicks = (window.__ctaClicks ?? 0) + 1;
              setStarted(true);
            }}
          >
            {started ? 'You are on the list' : 'Start building'}
          </button>
          <a className="btn" href="#docs">Read the docs</a>
        </div>
        <ul className="stats">
          <li><strong>$48B</strong><span>processed in 2025</span></li>
          <li><strong>99.999%</strong><span>API uptime</span></li>
          <li><strong>&lt; 90s</strong><span>median payout</span></li>
        </ul>
      </main>
    </div>
  );
}
