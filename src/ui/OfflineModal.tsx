import { Clock, Compass, Swords, Timer } from 'lucide-react';
import { useGame } from '../app/useGameStore';
import { skillsById } from '../data/skills';
import { formatNumber } from '../systems/formulas';
import type { OfflineMapSummary } from '../types/game';

function travelStatusText(map: OfflineMapSummary): string {
  if (map.interruptedBy === 'combat') return 'Stopped — an encounter began';
  if (map.interruptedBy === 'time') return 'Stopped — offline time ran out';
  if (map.arrivedTileName) return 'Arrived';
  return 'Journey advanced';
}

function TravelStatusIcon({ map }: { map: OfflineMapSummary }) {
  if (map.interruptedBy === 'combat') return <Swords size={15} />;
  if (map.interruptedBy === 'time') return <Timer size={15} />;
  return <Compass size={15} />;
}

export function OfflineModal() {
  const { state, dispatch } = useGame();
  const summary = state.offlineSummary;
  if (!summary) return null;

  const minutes = Math.floor(summary.secondsAway / 60);
  const seconds = summary.secondsAway % 60;
  const map = summary.map;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="offline-title">
        <div className="modal-title-row">
          <Clock size={22} />
          <h2 id="offline-title">Offline gains</h2>
        </div>
        <p className="muted-copy">
          Away for {minutes}m {seconds}s{summary.capped ? ' (24h cap applied)' : ''}.
        </p>
        {summary.actionName ? (
          <div className="offline-grid">
            <span>Action</span>
            <strong>{summary.actionName}</strong>
            <span>Completions</span>
            <strong>{formatNumber(summary.completions, state.settings.compactNumbers)}</strong>
            {Object.entries(summary.xp).map(([skillId, xp]) => (
              <span key={skillId}>{skillsById[skillId as keyof typeof skillsById].name} XP</span>
            ))}
            {Object.entries(summary.xp).map(([skillId, xp]) => (
              <strong key={`${skillId}-xp`}>{formatNumber(xp ?? 0, state.settings.compactNumbers)}</strong>
            ))}
            {summary.rewards.map((reward) => (
              <span key={reward.label}>{reward.label}</span>
            ))}
            {summary.rewards.map((reward) => (
              <strong key={`${reward.label}-qty`}>{formatNumber(reward.quantity, state.settings.compactNumbers)}</strong>
            ))}
          </div>
        ) : (
          <p>No active action was running.</p>
        )}
        {map.advanced && (
          <div className="offline-grid offline-map-grid">
            <span>Map</span>
            <strong>{map.arrivedTileName ?? 'On the road'}</strong>
            <span>Travel</span>
            <strong className={`offline-travel-status ${map.interruptedBy ?? 'arrived'}`}>
              <TravelStatusIcon map={map} />
              {travelStatusText(map)}
            </strong>
          </div>
        )}
        <button className="primary-button" onClick={() => dispatch({ type: 'dismissOffline' })}>OK</button>
      </section>
    </div>
  );
}
