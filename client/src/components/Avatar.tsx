import { artUrl } from '../art';
import { Icon } from './Icon';

/** Round profile picture in a gold ring. Falls back to a hooded figure. */
export function Avatar({
  url,
  name,
  size = 40,
  className = '',
}: {
  url: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt={`${name}'s profile picture`} width={size} height={size} />
      ) : (
        <span className="avatar__default" role="img" aria-label={`${name} has no profile picture`}>
          {artUrl('avatar-default') ? <img src={artUrl('avatar-default')} alt="" /> : <Icon name="hooded-figure" />}
        </span>
      )}
    </span>
  );
}
