import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { findClass, MAX_STAT, STAT_INFO, STAT_KEYS, type StatKey, type Stats } from '../../../shared/classes';
import { attackDamage, upgradeCost, weaponFor, type WeaponStats } from '../../../shared/combat';
import { findGrace, SAVE_SLOTS } from '../../../shared/graces';
import { MAP } from '../../../shared/mapData';
import type { PlayerInfo } from '../../../shared/protocol';
import { deriveStats } from '../../../shared/sim';
import { api, ApiError, type SaveSlot } from '../api';
import type { MapView } from '../game/GameClient';
import { BinaryDust } from './BinaryDust';
import { WorldMap, WorldMapLegend } from './WorldMap';

type Tab = 'upgrade' | 'travel' | 'characters';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'upgrade', label: 'Upgrade stats' },
  { id: 'travel', label: 'Travel' },
  { id: 'characters', label: 'Characters' },
];

function whole(value: number): string {
  return String(Math.round(value));
}

function oneDecimal(value: number): string {
  return value.toFixed(1);
}

/** What one more point does, in the numbers from the same rules the server plays by. */
function nextPointDoes(stat: StatKey, stats: Stats, weapon: WeaponStats): string[] {
  const raised = { ...stats, [stat]: stats[stat] + 1 };
  const now = deriveStats(stats, weapon);
  const next = deriveStats(raised, weapon);
  const lines: string[] = [];
  const damageNow = attackDamage(weapon, stats);
  const damageNext = attackDamage(weapon, raised);
  if (damageNext !== damageNow) lines.push(`Your weapon's damage goes from ${damageNow} to ${damageNext}.`);
  if (stat === 'health') lines.push(`Maximum health goes from ${whole(now.maxHealth)} to ${whole(next.maxHealth)}.`);
  if (stat === 'stamina') lines.push(`Maximum stamina goes from ${whole(now.maxStamina)} to ${whole(next.maxStamina)}, and it comes back faster.`);
  if (stat === 'arcane') lines.push(`Maximum magic goes from ${whole(now.maxMagic)} to ${whole(next.maxMagic)}, and it comes back faster.`);
  if (stat === 'speed') lines.push(`Walking speed goes from ${oneDecimal(now.moveSpeed)} to ${oneDecimal(next.moveSpeed)}, and your attacks get a little quicker.`);
  if (stat === 'dexterity') lines.push('Your dodge roll stays safe from hits for a little longer.');
  if (stat === 'strength') lines.push('Your hits knock enemies off balance a little more easily.');
  return lines;
}

function UpgradeTab({ me, dust, onUpgrade }: { me: PlayerInfo; dust: number; onUpgrade: (stat: StatKey) => void }) {
  const cost = upgradeCost(me.level);
  const weapon = weaponFor(me.classId, me.appearance.variant);
  return (
    <div className="grace-menu__body">
      <p className="grace-menu__lead">
        You are level {me.level}. Raising any stat by one costs <strong>{cost.toLocaleString()}</strong> Binary Dust and adds a level,
        so each one costs more than the last. No stat can go past {MAX_STAT}.
      </p>
      <ul className="grace-stats">
        {STAT_KEYS.map((stat) => {
          const value = me.stats[stat];
          const atCap = value >= MAX_STAT;
          return (
            <li key={stat} className="grace-stat">
              <div className="grace-stat__head">
                <strong>{STAT_INFO[stat].label}</strong>
                <span className="grace-stat__numbers">{atCap ? `${value} (highest)` : `${value} → ${value + 1}`}</span>
              </div>
              <p className="grace-stat__effect">{STAT_INFO[stat].effect}.</p>
              {!atCap && nextPointDoes(stat, me.stats, weapon).map((line) => <p key={line} className="grace-stat__next">{line}</p>)}
              <button type="button" className="btn btn--small" disabled={atCap || dust < cost} onClick={() => onUpgrade(stat)}>
                Raise {STAT_INFO[stat].label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TravelTab({
  view,
  lit,
  here,
  onTravel,
}: {
  view: () => MapView;
  lit: number[];
  here: number;
  onTravel: (grace: number) => void;
}) {
  const known = MAP.graces.filter((grace) => lit.includes(grace.id));
  return (
    <div className="grace-menu__body">
      <p className="grace-menu__lead">Go straight to any Binary Grace you have found. Choose one from the list or on the map.</p>
      <div className="grace-travel-layout">
        <ul className="grace-travel">
          {known.map((grace) => (
            <li key={grace.id}>
              <button type="button" className="btn btn--small btn--block" disabled={grace.id === here} onClick={() => onTravel(grace.id)}>
                {grace.id === here ? `${grace.name} (you are here)` : grace.name}
              </button>
            </li>
          ))}
        </ul>
        <WorldMap view={view} lit={lit} here={here} onPick={onTravel} />
      </div>
      <WorldMapLegend />
    </div>
  );
}

type Pending = { kind: 'load' | 'new'; slot: number };

function CharactersTab({ pendingRef }: { pendingRef: MutableRefObject<(() => boolean) | null> }) {
  const navigate = useNavigate();
  const [slots, setSlots] = useState<SaveSlot[] | null>(null);
  const [active, setActive] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    api.saves().then(
      (result) => {
        if (!current) return;
        setSlots(result.slots);
        setActive(result.active);
      },
      () => {
        if (current) setError('Your saves could not be loaded. Please try again.');
      },
    );
    return () => {
      current = false;
    };
  }, []);

  // Backing out of the question comes before backing out of the menu.
  useEffect(() => {
    pendingRef.current = pending
      ? () => {
          setPending(null);
          return true;
        }
      : null;
    return () => {
      pendingRef.current = null;
    };
  }, [pending, pendingRef]);

  const confirm = async () => {
    if (!pending) return;
    if (pending.kind === 'new') {
      navigate(`/create?slot=${pending.slot}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.selectSave(pending.slot);
      // Starting over is the one way to be sure nothing from the old save stays on screen.
      window.location.reload();
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'That save could not be loaded. Please try again.');
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div className="grace-menu__body">
      <p className="grace-menu__lead">
        Your account has {SAVE_SLOTS} saves. Each one is its own character, with its own stats, Binary Dust and places found.
      </p>
      {error && <p className="form__error" role="alert">{error}</p>}
      {!slots && !error && <p className="grace-menu__lead">Loading your saves…</p>}
      <ul className="grace-saves">
        {slots?.map(({ slot, character }) => (
          <li key={slot} className={`grace-save${slot === active ? ' grace-save--active' : ''}`}>
            <div>
              <strong>Save {slot}{slot === active ? ' (playing now)' : ''}</strong>
              <p>
                {character
                  ? `Level ${character.level} ${findClass(character.classId)?.name ?? ''}, ${character.binaryDust.toLocaleString()} Binary Dust, ${character.graces} of ${MAP.graces.length} Binary Graces found`
                  : 'Empty'}
              </p>
            </div>
            {pending?.slot === slot ? (
              <div className="grace-save__confirm" role="group" aria-label="Please confirm">
                <p>
                  {pending.kind === 'load'
                    ? 'Leave the world and come back as this character? Your current character stays saved.'
                    : 'Leave the world to make a new character in this save? Your current character stays saved.'}
                </p>
                <button type="button" className="btn btn--small btn--primary" disabled={busy} autoFocus onClick={() => void confirm()}>
                  Yes, {pending.kind === 'load' ? 'load it' : 'make one'}
                </button>
                <button type="button" className="btn btn--small" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            ) : character ? (
              slot !== active && (
                <button type="button" className="btn btn--small" onClick={() => setPending({ kind: 'load', slot })}>
                  Load
                </button>
              )
            ) : (
              <button type="button" className="btn btn--small" onClick={() => setPending({ kind: 'new', slot })}>
                New character
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What you can do while sitting at a Binary Grace. Every button only asks: the server decides. */
export function GraceMenu({
  grace,
  me,
  dust,
  lit,
  view,
  backRef,
  onUpgrade,
  onTravel,
  onOpenMap,
  onStand,
}: {
  grace: number;
  me: PlayerInfo;
  dust: number;
  lit: number[];
  view: () => MapView;
  /** Set while something inside the menu wants Esc or the back button first. Returns true when it used it. */
  backRef: MutableRefObject<(() => boolean) | null>;
  onUpgrade: (stat: StatKey) => void;
  onTravel: (grace: number) => void;
  onOpenMap: () => void;
  onStand: () => void;
}) {
  const [tab, setTab] = useState<Tab>('upgrade');
  const first = useRef<HTMLButtonElement>(null);

  // A controller has nothing to move until something has focus.
  useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <aside className={`grace-menu${tab === 'travel' ? ' grace-menu--wide' : ''}`} aria-label="Binary Grace">
      <header className="grace-menu__head">
        <h1>{findGrace(MAP.graces, grace)?.name ?? 'Binary Grace'}</h1>
        <p className="grace-menu__rested">Rested. Health, magic, stamina and potions are full, and you will come back here if you fall.</p>
        <p className="grace-menu__dust"><BinaryDust /> <strong>{dust.toLocaleString()}</strong> Binary Dust</p>
      </header>
      <nav className="grace-menu__tabs">
        {TABS.map(({ id, label }, index) => (
          <button
            key={id}
            ref={index === 0 ? first : undefined}
            type="button"
            className={`grace-menu__tab${tab === id ? ' grace-menu__tab--on' : ''}`}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="grace-menu__tab" onClick={onOpenMap}>World map</button>
      </nav>
      {tab === 'upgrade' && <UpgradeTab me={me} dust={dust} onUpgrade={onUpgrade} />}
      {tab === 'travel' && <TravelTab view={view} lit={lit} here={grace} onTravel={onTravel} />}
      {tab === 'characters' && <CharactersTab pendingRef={backRef} />}
      <button type="button" className="btn btn--primary btn--block grace-menu__stand" onClick={onStand}>
        Stand up
      </button>
    </aside>
  );
}
