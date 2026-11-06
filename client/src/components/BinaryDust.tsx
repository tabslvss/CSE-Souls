import { useEffect, useRef } from 'react';

const DIGITS = 6;
const TWITCH_MS = 90;

/**
 * The game's currency icon: a small cluster of red digits twitching between 0 and 1. It writes
 * straight to the page instead of re-rendering React, since it changes constantly.
 */
export function BinaryDust({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const digits = [...element.children] as HTMLElement[];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      for (const digit of digits) {
        if (Math.random() < 0.45) {
          digit.textContent = Math.random() < 0.5 ? '0' : '1';
          digit.style.transform = `translate(${(Math.random() * 3 - 1.5) | 0}px, ${(Math.random() * 3 - 1.5) | 0}px)`;
          digit.style.opacity = String(0.55 + Math.random() * 0.45);
        }
      }
    }, TWITCH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span ref={ref} className={`binary-dust ${className}`} aria-hidden="true">
      {Array.from({ length: DIGITS }, (_, index) => (
        <i key={index}>{index % 2}</i>
      ))}
    </span>
  );
}
