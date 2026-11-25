import manifest from '../../../packages/templates/manifest.json';

export interface TemplateInfo {
  id: string;
  title: string;
  description: string;
  accent: string;
  source: string;
}

const sources = import.meta.glob('../../../packages/templates/templates/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const byId = new Map(Object.entries(sources).map(([path, text]) => [path.split('/').pop()?.replace('.tsx', '') ?? path, text]));

export const TEMPLATES: TemplateInfo[] = manifest.templates.map((t) => ({ ...t, source: byId.get(t.id) ?? '' }));
