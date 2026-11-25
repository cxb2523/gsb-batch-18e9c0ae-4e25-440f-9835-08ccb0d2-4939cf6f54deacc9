import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export const toHex6 = (hex: string): string => {
  const h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  return `#${h.slice(0, 6)}`;
};

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

interface NumberFieldProps {
  label?: string;
  value: number;
  step: number;
  dim?: boolean;
  disabled?: boolean;
  onLive?: (v: number) => void;
  onCommit: (v: number) => void;
  /** Small axis marker shown instead of a label, for vec3 rows. */
  axis?: 'x' | 'y' | 'z';
}

/** A number input whose label is a drag handle (scrub). Shift is 10x, Alt is 0.1x. Commits on release, Enter or blur. */
export function NumberField({ label, value, step, dim, disabled, onLive, onCommit, axis }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const scrub = useRef<{ x: number; start: number; moved: boolean; current: number } | null>(null);

  const commitText = (text: string) => {
    setDraft(null);
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n);
  };

  const down = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, start: value, moved: false, current: value };
  };
  const move = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const s = scrub.current;
    if (!s) return;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const next = s.start + ((e.clientX - s.x) / 4) * step * mult;
    if (Math.abs(e.clientX - s.x) > 1) s.moved = true;
    s.current = Math.round(next * 1000) / 1000;
    onLive?.(s.current);
    setDraft(fmt(s.current));
  };
  const up = () => {
    const s = scrub.current;
    scrub.current = null;
    if (s?.moved) onCommit(s.current);
    setDraft(null);
  };

  return (
    <label className={`num${dim ? ' dim' : ''}${disabled ? ' disabled' : ''}`}>
      <span className="num-label" data-axis={axis} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {axis ?? label}
      </span>
      <input
        value={draft ?? fmt(value)}
        disabled={disabled}
        inputMode="decimal"
        spellCheck={false}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commitText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            onCommit(Math.round((value + dir * step * (e.shiftKey ? 10 : 1)) * 1000) / 1000);
          }
        }}
      />
    </label>
  );
}

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onLive?: (v: number) => void;
  onCommit: (v: number) => void;
}

export function Slider({ value, min, max, step, onLive, onCommit }: SliderProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const finish = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const pct = max === min ? 0 : ((Math.min(Math.max(shown, min), max) - min) / (max - min)) * 100;
  return (
    <input
      className="slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={Math.min(Math.max(shown, min), max)}
      style={{ ['--pct' as string]: `${pct}%` }}
      onChange={(e) => {
        const v = Number(e.target.value);
        setDraft(v);
        onLive?.(v);
      }}
      onPointerUp={finish}
      onKeyUp={finish}
      onBlur={finish}
    />
  );
}

export function ColorField({ value, onLive, onCommit }: { value: string; onLive?: (v: string) => void; onCommit: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => {
      if (el.value.toLowerCase() !== toHex6(latest.current).toLowerCase()) onCommit(el.value);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  });
  return (
    <div className="color">
      <input ref={ref} type="color" value={toHex6(value)} onInput={(e) => onLive?.((e.target as HTMLInputElement).value)} onChange={() => undefined} />
      <input
        className="color-text"
        value={text ?? value}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null && /^#[0-9a-fA-F]{6}$/.test(text) && text.toLowerCase() !== value.toLowerCase()) onCommit(text.toLowerCase());
          setText(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={value} className={`toggle${value ? ' on' : ''}`} onClick={() => onChange(!value)}>
      <span />
    </button>
  );
}
