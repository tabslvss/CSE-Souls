import { artUrl } from '../art';
import { Icon } from './Icon';

const ICONS: Record<string, string> = {
  welcome: 'campfire',
  profile_picture: 'portrait',
  first_blood: 'blood',
  beast_hunter: 'deer-head',
  grave_walker: 'tombstone',
  boss_slayer: 'crowned-skull',
  unbroken: 'checked-shield',
};

/** Medallion for an achievement: gold when earned, grey when locked. */
export function AchievementGlyph({ id, unlocked }: { id: string; unlocked: boolean }) {
  const medal = artUrl(`ach-${id}`);
  return (
    <span className={`glyph ${medal ? 'glyph--art' : ''}`} data-unlocked={unlocked}>
      {medal ? <img src={medal} alt="" loading="lazy" /> : <Icon name={ICONS[id] ?? 'campfire'} />}
    </span>
  );
}
