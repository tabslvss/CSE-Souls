import { useEffect, useState } from 'react';
import type { Achievement } from '../api';
import { sound } from '../sound';
import { AchievementGlyph } from './AchievementGlyph';

type Listener = (achievement: Achievement) => void;
const listeners = new Set<Listener>();

/** Announces a newly unlocked achievement, from anywhere in the app. */
export function announceAchievement(achievement: Achievement): void {
  sound.play('unlock');
  listeners.forEach((listener) => listener(achievement));
}

const VISIBLE_MS = 6000;

export function Toasts() {
  const [items, setItems] = useState<Achievement[]>([]);

  useEffect(() => {
    const listener: Listener = (achievement) => {
      setItems((current) => [...current, achievement]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item !== achievement));
      }, VISIBLE_MS);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div className="toast" key={item.id}>
          <AchievementGlyph id={item.id} unlocked />
          <div>
            <p className="toast__label">Achievement unlocked</p>
            <p className="toast__name">{item.name}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
