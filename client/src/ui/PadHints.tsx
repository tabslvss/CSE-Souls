import { useEffect, useId, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { PadGlyph, useInputDevice, type PadButton } from '../components/InputGlyph';

export interface PadHint {
  button: PadButton;
  label: string;
}

export interface PadHintsProps {
  hints: PadHint[];
  /**
   * 'bar' (the default) is the one fixed bar along the bottom of the screen. When several are
   * mounted, only the one with the highest priority shows, and the newest among equals.
   * 'inline' sits wherever it is rendered, such as along the foot of a dialog.
   */
  placement?: 'bar' | 'inline';
  /** Only for 'bar'. The site's own default bar uses -1, so any screen's bar replaces it. */
  priority?: number;
  className?: string;
}

interface Entry {
  key: string;
  priority: number;
  order: number;
}

let entries: Entry[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function topKey(): string | null {
  let best: Entry | null = null;
  for (const entry of entries) {
    if (!best || entry.priority > best.priority || (entry.priority === best.priority && entry.order > best.order)) best = entry;
  }
  return best?.key ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function HintList({ hints, className }: { hints: PadHint[]; className: string }) {
  return (
    <ul className={className} aria-label="Controller buttons">
      {hints.map(({ button, label }) => (
        <li key={`${button}-${label}`} className="pad-hints__item">
          <span className="pad-hints__glyphs"><PadGlyph button={button} /></span>
          <span className="pad-hints__label">{label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Button pictures and what they do, shown only while a controller is the device in use. */
export function PadHints({ hints, placement = 'bar', priority = 0, className = '' }: PadHintsProps) {
  const device = useInputDevice();
  const key = useId();
  const top = useSyncExternalStore(subscribe, topKey, () => null);

  useEffect(() => {
    if (placement !== 'bar') return;
    entries = [...entries, { key, priority, order: ++counter }];
    notify();
    return () => {
      entries = entries.filter((entry) => entry.key !== key);
      notify();
    };
  }, [key, placement, priority]);

  if (device === 'keyboard' || hints.length === 0) return null;
  if (placement === 'inline') return <HintList hints={hints} className={`pad-hints pad-hints--inline ${className}`} />;
  if (top !== key) return null;
  return createPortal(
    <div className={`pad-hints-bar ${className}`} data-pad-skip>
      <HintList hints={hints} className="pad-hints" />
    </div>,
    document.body,
  );
}
