import { artUrl } from '../art';
import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

function Corner({ className }: { className: string }) {
  return (
    <svg className={`corner ${className}`} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M.5 32V8C.5 3.900 3.900.5 8 .5h24" fill="none" stroke="currentColor" />
      <path d="m8 4 4 4-4 4-4-4z" fill="currentColor" />
    </svg>
  );
}

/** Framed surface used throughout the site. */
export function Panel({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  return (
    <Tag className={`panel ${className}`}>
      <Corner className="corner--tl" />
      <Corner className="corner--tr" />
      <Corner className="corner--bl" />
      <Corner className="corner--br" />
      {children}
    </Tag>
  );
}

export function Divider({ className = '' }: { className?: string }) {
  const painted = artUrl('ui-divider');
  if (painted) {
    return (
      <div className={`divider ${className}`} aria-hidden="true">
        <img className="divider__art" src={painted} alt="" />
      </div>
    );
  }
  return (
    <div className={`divider ${className}`} aria-hidden="true">
      <span className="divider__line" />
      <svg viewBox="0 0 16 16" className="divider__gem">
        <path d="M8 1 15 8 8 15 1 8Z" fill="none" stroke="currentColor" />
        <path d="M8 5 11 8 8 11 5 8Z" fill="currentColor" />
      </svg>
      <span className="divider__line divider__line--flip" />
    </div>
  );
}

/** The brand mark: a gold flame inside a diamond. */
export function Sigil({ className = '' }: { className?: string }) {
  const painted = artUrl('sigil');
  if (painted) return <img className={`sigil ${className}`} src={painted} alt="" />;
  return (
    <svg className={`sigil ${className}`} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 3 61 32 32 61 3 32Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M32 11 53 32 32 53 11 32Z" fill="none" stroke="currentColor" opacity=".4" />
      <path
        d="M32 17c4.700 6.600 9.500 11.300 9.500 18.500a9.500 9.500 0 0 1-19 0c0-4.800 2.800-7.700 4.800-10.500.9 2.800 1.900 3.800 2.800 4.700.9-3.800.9-8.500 1.900-12.700Z"
        fill="var(--gold)"
      />
      <path d="M32 30c1.900 2.800 3.800 4.700 3.800 7.600a3.800 3.800 0 0 1-7.600 0c0-2.900 2.900-4.800 3.800-7.600Z" fill="var(--gold-pale)" />
    </svg>
  );
}

/** Fades its content in the first time it scrolls into view. */
export function Reveal({
  children,
  className = '',
  as: Tag = 'div',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${className}`}
      data-visible={visible}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="section-heading">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      <Divider />
      {children && <p className="section-heading__lede">{children}</p>}
    </header>
  );
}
