/**
 * A game-icons.net icon drawn in the current text color. It uses a CSS mask, so one
 * white SVG file can appear in any color.
 */
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  const url = `url(/icons/${name}.svg)`;
  return <i className={`icon ${className}`} style={{ maskImage: url, WebkitMaskImage: url }} aria-hidden="true" />;
}
