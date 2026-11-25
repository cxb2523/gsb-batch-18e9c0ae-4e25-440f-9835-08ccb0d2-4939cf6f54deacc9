import type { TemplateInfo } from '../templates';
import { GitHubLink, RunLocally } from './RunLocally';

export interface TopBarProps {
  templates: TemplateInfo[];
  templateId: string;
  onTemplate: (id: string) => void;
  modified: boolean;
  onReset: () => void;
  onCopy: () => void;
  toast: string | null;
}

export function TopBar({ templates, templateId, onTemplate, modified, onReset, onCopy, toast }: TopBarProps) {
  const current = templates.find((t) => t.id === templateId);
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden><path d="M16 3 29 26H3z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" /><path d="M16 3v23M16 14l13 12" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".55" /></svg>
        <span className="brand-name">prismbox</span>
        <span className="tag">Playground</span>
      </div>
      <div className="template-switch" title={current?.description}>
        <span className="swatch" style={{ background: current?.accent }} />
        <select aria-label="Template" value={templateId} onChange={(e) => onTemplate(e.target.value)}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </div>
      <div className="file">
        <code>Hero.tsx</code>
        <span className={`dot${modified ? ' modified' : ''}`} />
        <span className="file-state">{modified ? 'edited, saved in this browser' : 'template as shipped'}</span>
      </div>
      <div className="spacer" />
      {toast && <span className="toast" role="status">{toast}</span>}
      <GitHubLink />
      <RunLocally />
      <button type="button" className="btn ghost" onClick={onReset} disabled={!modified} title="Back to the template as shipped">Reset</button>
      <button type="button" className="btn primary" onClick={onCopy} title="Copy the file as plain, dependency-free R3F">Copy .tsx</button>
    </header>
  );
}
