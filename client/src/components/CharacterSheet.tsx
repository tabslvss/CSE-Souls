import { useEffect, useRef, useState, type ReactNode } from 'react';
import { findClass, STAT_INFO, STAT_KEYS } from '../../../shared/classes';
import { upgradeCost } from '../../../shared/combat';
import type { Player } from '../api';
import { BinaryDust } from './BinaryDust';
import { AchievementGlyph } from './AchievementGlyph';
import { Avatar } from './Avatar';
import { Divider, Panel } from './Ornaments';
import { PadHints, type PadHint } from '../ui/PadHints';
import '../styles/grace-pad.css';

/** What the buttons do on this page, which depends on whether the highlight is on something to press. */
function sheetHints(pressable: boolean): PadHint[] {
  return [
    { button: 'dpad', label: 'Move' },
    ...(pressable ? [{ button: 'confirm' as const, label: 'Select' }] : []),
    { button: 'scroll', label: 'Scroll' },
    { button: 'back', label: 'Back' },
  ];
}

export function CharacterSheet({ player, portraitActions }: { player: Player; portraitActions?: ReactNode }) {
  // Levels are bought with dust at a Binary Grace, so this bar is how close the next one is.
  const needed = upgradeCost(player.level);
  const dustShare = Math.min(100, (player.binaryDust / needed) * 100);
  const earned = player.achievements.filter((item) => item.unlockedAt);
  const { record } = player;
  const classDefinition = findClass(player.classId);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pressable, setPressable] = useState(false);

  // Stats and achievements can be landed on to read them; only buttons and links do anything when pressed.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocus = () => {
      const active = document.activeElement;
      setPressable(!!active && root.contains(active) && active.matches('button, a[href]'));
    };
    root.addEventListener('focusin', onFocus);
    root.addEventListener('focusout', onFocus);
    return () => {
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('focusout', onFocus);
    };
  }, []);

  return (
    <div ref={rootRef} className="sheet">
      <PadHints hints={sheetHints(pressable)} />
      <Panel className="sheet__portrait">
        <Avatar url={player.avatarUrl} name={player.username} size={168} className="avatar--large" />
        <h1 className="sheet__name">{player.username}</h1>
        <p className="sheet__level">
          Level {player.level}
          {classDefinition ? ` ${classDefinition.name}` : ''}
        </p>
        <div className="xp">
          <div className="bar bar--xp"><span style={{ width: `${dustShare}%` }} /></div>
          <p className="xp__label">
            {player.binaryDust.toLocaleString()} / {needed.toLocaleString()} Binary Dust for the next level
          </p>
        </div>
        <p className="sheet__joined">Joined {new Date(player.joinedAt).toLocaleDateString()}</p>
        {portraitActions}
      </Panel>

      <div className="sheet__body">
        <Panel>
          <h2 className="panel-title">Stats</h2>
          <Divider />
          <ul className="attributes">
            {STAT_KEYS.map((key) => (
              <li key={key} data-pad-item className="sheet__stat">
                <span className="attributes__name">{STAT_INFO[key].label}</span>
                <span className="attributes__effect">{STAT_INFO[key].effect}</span>
                <span className="attributes__value">{player.stats[key]}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <h2 className="panel-title">Record</h2>
          <Divider />
          <dl className="stats">
            <div><dt>Binary Dust</dt><dd className="stats__dust"><BinaryDust />{player.binaryDust.toLocaleString()}</dd></div>
            <div><dt>Boss kills</dt><dd>{record.bossKills.toLocaleString()}</dd></div>
            <div><dt>Boss damage</dt><dd>{record.bossDamage.toLocaleString()}</dd></div>
            <div><dt>Enemies killed</dt><dd>{record.enemiesKilled.toLocaleString()}</dd></div>
            <div><dt>Animals hunted</dt><dd>{record.animalsHunted.toLocaleString()}</dd></div>
            <div><dt>Deaths</dt><dd>{record.deaths.toLocaleString()}</dd></div>
          </dl>
        </Panel>

        <Panel className="sheet__wide">
          <h2 className="panel-title">
            Achievements <span className="panel-title__count">{earned.length} of {player.achievements.length}</span>
          </h2>
          <Divider />
          <ul className="medals">
            {player.achievements.map((item) => (
              <li key={item.id} title={item.description} data-unlocked={!!item.unlockedAt} data-pad-item className="sheet__medal">
                <AchievementGlyph id={item.id} unlocked={!!item.unlockedAt} />
                <span>{item.name}</span>
                {/* The description is a hover title for the mouse; a controller shows it under the medal instead. */}
                <span className="sheet__medal-tip" aria-hidden="true">
                  <strong>{item.unlockedAt ? 'Earned' : 'Not earned yet'}</strong>
                  {item.description}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
