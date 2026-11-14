import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { findClass, MAX_STAT, STAT_INFO, STAT_KEYS, type StatKey, type Stats } from '../../../shared/classes';
import { attackDamage, upgradeCost, weaponFor, type WeaponStats } from '../../../shared/combat';
import { findGrace, SAVE_SLOTS } from '../../../shared/graces';
import { MAP } from '../../../shared/mapData';
import type { PlayerInfo } from '../../../shared/protocol';
import { deriveStats } from '../../../shared/sim';
import { api, ApiError, type SaveSlot } from '../api';
import type { MapView } from '../game/GameClient';
import { getInputDevice } from '../game/inputDevice';
import { sound } from '../sound';
import { PadHints, type PadHint } from '../ui/PadHints';
import { padFocus, showPadNote, type PadNavDetail } from '../ui/padNav';
import { BinaryDust } from './BinaryDust';
import { WorldMap, WorldMapLegend } from './WorldMap';
import '../styles/grace-pad.css';

type Tab = 'upgrade' | 'travel' | 'characters';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'upgrade', label: 'Upgrade stats' },
  { id: 'travel', label: 'Travel' },
  { id: 'characters', label: 'Characters' },
];

/** Points planned on a controller but not bought yet. */
type Plan = Partial<Record<StatKey, number>>;

/** Where the controller highlight is, so the hint bar can say what the buttons do there. */
type Zone = 'tabs' | 'stat' | 'travel' | 'confirm' | 'body' | 'stand' | 'none';

/** How long to wait for the server to agree to one point before giving up on the rest. */
const APPLY_WAIT_MS = 5000;

function whole(value: number): string {
  return String(Math.round(value));
}

function oneDecimal(value: number): string {
  return value.toFixed(1);
}

function planTotal(plan: Plan): number {
  return STAT_KEYS.reduce((sum, stat) => sum + (plan[stat] ?? 0), 0);
}

/** The dust that this many points cost in a row, starting at this level. Each point raises the level. */
function costOf(level: number, points: number): number {
  let sum = 0;
  for (let index = 0; index < points; index += 1) sum += upgradeCost(level + index);
  return sum;
}

function withPlan(stats: Stats, plan: Plan): Stats {
  const next = { ...stats };
  for (const stat of STAT_KEYS) next[stat] += plan[stat] ?? 0;
  return next;
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

function UpgradeTab({
  me,
  dust,
  plan,
  applying,
  onUpgrade,
  onApply,
  onClear,
}: {
  me: PlayerInfo;
  dust: number;
  plan: Plan;
  applying: boolean;
  onUpgrade: (stat: StatKey) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const cost = upgradeCost(me.level);
  const weapon = weaponFor(me.classId, me.appearance.variant);
  const planned = planTotal(plan);
  const planCost = costOf(me.level, planned);
  const plannedStats = withPlan(me.stats, plan);
  // The price of the point after everything already planned.
  const nextCost = upgradeCost(me.level + planned);
  return (
    <div className="grace-menu__body" data-pad-default>
      <p className="grace-menu__lead">
        You are level {me.level}. Raising any stat by one costs <strong>{cost.toLocaleString()}</strong> Binary Dust and adds a level,
        so each one costs more than the last. No stat can go past {MAX_STAT}.
      </p>
      <p className="grace-pad__only grace-pad__how">
        Press left or right on a stat to plan points, then confirm to buy them all at once.
      </p>
      <ul className="grace-stats">
        {STAT_KEYS.map((stat) => {
          const value = me.stats[stat];
          const extra = plan[stat] ?? 0;
          const shown = plannedStats[stat];
          const atCap = value >= MAX_STAT;
          const plannedCap = shown >= MAX_STAT;
          const canAfford = dust - planCost >= nextCost;
          return (
            <li
              key={stat}
              className={`grace-stat${extra > 0 ? ' grace-stat--planned' : ''}`}
              data-stat={stat}
              data-pad-item
              data-pad-adjust
            >
              <div className="grace-stat__head">
                <strong>{STAT_INFO[stat].label}</strong>
                <span className="grace-stat__numbers">
                  <span className="grace-pad__only grace-stat__arrow" aria-hidden="true" data-off={extra === 0 || undefined}>‹</span>
                  {extra > 0
                    ? `${value} → ${shown}`
                    : atCap
                      ? `${value} (highest)`
                      : `${value} → ${value + 1}`}
                  <span className="grace-pad__only grace-stat__arrow" aria-hidden="true" data-off={plannedCap || !canAfford || undefined}>›</span>
                </span>
              </div>
              <p className="grace-stat__effect">{STAT_INFO[stat].effect}.</p>
              {!plannedCap && nextPointDoes(stat, plannedStats, weapon).map((line) => <p key={line} className="grace-stat__next">{line}</p>)}
              <p className={`grace-pad__only grace-stat__cost${plannedCap || !canAfford ? ' grace-stat__cost--short' : ''}`}>
                <BinaryDust />
                {plannedCap
                  ? 'This stat is at its highest.'
                  : canAfford
                    ? <>Next point: <strong>{nextCost.toLocaleString()}</strong> Binary Dust</>
                    : <>Next point needs <strong>{nextCost.toLocaleString()}</strong> Binary Dust</>}
                {extra > 0 && <span className="grace-stat__planned">+{extra} planned</span>}
              </p>
              <button
                type="button"
                className="btn btn--small grace-stat__raise"
                data-pad-skip
                disabled={atCap || dust < cost || applying}
                onClick={() => onUpgrade(stat)}
              >
                Raise {STAT_INFO[stat].label}
              </button>
            </li>
          );
        })}
      </ul>
      {(planned > 0 || applying) && (
        <div className="grace-plan" role="status">
          {applying ? (
            <p className="grace-plan__text">Raising your stats…</p>
          ) : (
            <>
              <p className="grace-plan__text">
                {planned} {planned === 1 ? 'point' : 'points'} planned, level {me.level} to {me.level + planned}:{' '}
                <strong>{planCost.toLocaleString()}</strong> Binary Dust, leaving {(dust - planCost).toLocaleString()}.
              </p>
              <div className="grace-plan__buttons">
                <button type="button" className="btn btn--small btn--primary" onClick={onApply}>Buy these points</button>
                <button type="button" className="btn btn--small" onClick={onClear}>Clear the plan</button>
              </div>
            </>
          )}
        </div>
      )}
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
    <div className="grace-menu__body" data-pad-default>
      <p className="grace-menu__lead">Go straight to any Binary Grace you have found. Choose one from the list or on the map.</p>
      <div className="grace-travel-layout">
        <ul className="grace-travel">
          {known.map((grace) => {
            const isHere = grace.id === here;
            // Not disabled, only marked so: a disabled button can't hold the controller's highlight.
            return (
              <li key={grace.id}>
                <button
                  type="button"
                  className={`btn btn--small btn--block grace-travel__item${isHere ? ' grace-travel__item--here' : ''}`}
                  aria-disabled={isHere || undefined}
                  data-grace={grace.id}
                  onClick={() => {
                    if (!isHere) onTravel(grace.id);
                  }}
                >
                  {isHere ? `${grace.name} (you are here)` : grace.name}
                </button>
              </li>
            );
          })}
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
  const listRef = useRef<HTMLUListElement>(null);
  const asked = useRef<number | null>(null);

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

  // When the question closes, the highlight goes back to the button that asked it instead of getting lost.
  useEffect(() => {
    if (pending) {
      asked.current = pending.slot;
      return;
    }
    const slot = asked.current;
    asked.current = null;
    if (slot === null) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-slot-action="${slot}"]`);
    if (button) {
      if (getInputDevice() === 'keyboard') button.focus();
      else padFocus(button);
    }
  }, [pending]);

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
    <div className="grace-menu__body" data-pad-default>
      <p className="grace-menu__lead">
        Your account has {SAVE_SLOTS} saves. Each one is its own character, with its own stats, Binary Dust and places found.
      </p>
      {error && <p className="form__error" role="alert">{error}</p>}
      {!slots && !error && <p className="grace-menu__lead">Loading your saves…</p>}
      <ul ref={listRef} className="grace-saves">
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
                <button type="button" className="btn btn--small" disabled={busy} data-pad-back onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            ) : character ? (
              slot !== active && (
                <button type="button" className="btn btn--small" data-slot-action={slot} onClick={() => setPending({ kind: 'load', slot })}>
                  Load
                </button>
              )
            ) : (
              <button type="button" className="btn btn--small" data-slot-action={slot} onClick={() => setPending({ kind: 'new', slot })}>
                New character
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function hintsFor(tab: Tab, zone: Zone, planned: number): PadHint[] {
  const hints: PadHint[] = [];
  if (zone === 'stat') {
    hints.push({ button: 'dpadUpDown', label: 'Choose a stat' });
    hints.push({ button: 'adjust', label: 'Plan points' });
    hints.push({ button: 'confirm', label: planned > 0 ? 'Buy planned points' : 'Raise by one' });
    hints.push({ button: 'back', label: planned > 0 ? 'Clear the plan' : 'Back' });
  } else if (zone === 'confirm') {
    hints.push({ button: 'dpad', label: 'Move' });
    hints.push({ button: 'confirm', label: 'Select' });
    hints.push({ button: 'back', label: 'Cancel' });
  } else if (zone === 'tabs') {
    hints.push({ button: 'dpad', label: 'Move' });
    hints.push({ button: 'confirm', label: 'Open' });
    hints.push({ button: 'back', label: 'Stand up' });
  } else if (zone === 'stand' || zone === 'none') {
    hints.push({ button: 'dpad', label: 'Move' });
    hints.push({ button: 'confirm', label: zone === 'stand' ? 'Stand up' : 'Select' });
    hints.push({ button: 'back', label: 'Stand up' });
  } else {
    hints.push({ button: 'dpad', label: 'Move' });
    hints.push({ button: 'confirm', label: zone === 'travel' ? 'Travel there' : 'Select' });
    hints.push({ button: 'back', label: planned > 0 ? 'Clear the plan' : 'Back' });
  }
  hints.push({ button: 'tabs', label: 'Switch tab' });
  if (tab === 'travel') {
    hints.push({ button: 'leftStick', label: 'Map cursor' });
    hints.push({ button: 'triggers', label: 'Zoom' });
  } else {
    hints.push({ button: 'scroll', label: 'Scroll' });
  }
  hints.push({ button: 'y', label: 'World map' });
  return hints;
}

/** The first thing the controller can land on inside a tab's contents. */
function firstItem(body: Element | null): HTMLElement | null {
  if (!body) return null;
  const all = body.querySelectorAll<HTMLElement>('[data-stat], button:not(:disabled), a[href]');
  for (const element of all) {
    if (element.closest('[data-pad-skip]')) continue;
    if (element.getClientRects().length === 0) continue;
    return element;
  }
  return null;
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
  const [plan, setPlan] = useState<Plan>({});
  const [applying, setApplying] = useState(false);
  const [zone, setZone] = useState<Zone>('none');
  const rootRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const charactersBack = useRef<(() => boolean) | null>(null);
  const tabByPad = useRef(false);
  const queue = useRef<StatKey[]>([]);
  const applyTimer = useRef(0);

  // Everything the native listeners below need, always current.
  const latest = useRef({ me, dust, plan, applying, onUpgrade, onStand });
  latest.current = { me, dust, plan, applying, onUpgrade, onStand };

  const planned = planTotal(plan);

  const clearPlan = useCallback((): boolean => {
    if (planTotal(latest.current.plan) === 0) return false;
    setPlan({});
    return true;
  }, []);

  /** Sends the next planned point. The server takes one at a time, so the next waits for this one's level. */
  const sendNext = useCallback(() => {
    window.clearTimeout(applyTimer.current);
    const { me: now, dust: dustNow, onUpgrade: upgrade } = latest.current;
    const next = queue.current.shift();
    if (!next || now.stats[next] >= MAX_STAT || dustNow < upgradeCost(now.level)) {
      queue.current = [];
      setApplying(false);
      return;
    }
    setApplying(true);
    upgrade(next);
    applyTimer.current = window.setTimeout(() => {
      queue.current = [];
      setApplying(false);
    }, APPLY_WAIT_MS);
  }, []);

  const applyPlan = useCallback(() => {
    const current = latest.current.plan;
    const points: StatKey[] = [];
    for (const stat of STAT_KEYS) for (let index = 0; index < (current[stat] ?? 0); index += 1) points.push(stat);
    if (points.length === 0) return;
    queue.current = points;
    setPlan({});
    sendNext();
  }, [sendNext]);

  // Each point the server agrees to raises the level, which is the cue to ask for the next one.
  const lastLevel = useRef(me.level);
  useEffect(() => {
    if (me.level === lastLevel.current) return;
    lastLevel.current = me.level;
    if (latest.current.applying) sendNext();
  }, [me.level, sendNext]);

  useEffect(() => () => window.clearTimeout(applyTimer.current), []);

  // Esc and the Options button come through GamePage's backRef: a question first, then a plan.
  useEffect(() => {
    backRef.current = () => !!charactersBack.current?.() || clearPlan();
    return () => {
      backRef.current = null;
    };
  }, [backRef, clearPlan]);

  // Keyboard focus starts on the tabs, as before. A controller starts on the first stat.
  useEffect(() => {
    if (getInputDevice() === 'keyboard') {
      first.current?.focus();
      return;
    }
    const target = firstItem(bodyRef.current) ?? first.current;
    if (target) padFocus(target);
  }, []);

  // After the shoulder buttons switch tabs, the highlight moves into the new tab's contents.
  useEffect(() => {
    if (!tabByPad.current) return;
    tabByPad.current = false;
    const frame = requestAnimationFrame(() => {
      const target = firstItem(bodyRef.current);
      if (target) padFocus(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  // The controller: planning points with left and right, buying them, and stepping back one level with B.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const statOf = (element: Element | null): StatKey | null => {
      const row = element?.closest<HTMLElement>('[data-stat]');
      return row && root.contains(row) ? (row.dataset.stat as StatKey) : null;
    };

    const onAdjust = (event: Event) => {
      const stat = statOf(event.target as Element);
      if (!stat) return;
      event.preventDefault();
      const { me: now, dust: dustNow, plan: current, applying: busy } = latest.current;
      if (busy) return;
      const step = (event as CustomEvent<{ step: -1 | 1 }>).detail.step;
      const have = current[stat] ?? 0;
      if (step < 0) {
        if (have === 0) return;
        setPlan({ ...current, [stat]: have - 1 });
        sound.play('hover');
        return;
      }
      const total = planTotal(current);
      if (now.stats[stat] + have >= MAX_STAT) {
        showPadNote(`${STAT_INFO[stat].label} is already at its highest.`);
        sound.play('error');
        return;
      }
      if (costOf(now.level, total + 1) > dustNow) {
        showPadNote('Not enough Binary Dust for another point.');
        sound.play('error');
        return;
      }
      setPlan({ ...current, [stat]: have + 1 });
      sound.play('hover');
    };

    const onNav = (event: Event) => {
      const { action, scope } = (event as CustomEvent<PadNavDetail>).detail;
      // Only while this menu is the screen in charge, not the map opened on top of it.
      if (scope !== root) return;
      if (action === 'tabPrev' || action === 'tabNext') {
        tabByPad.current = true;
        return;
      }
      if (action !== 'confirm') return;
      const stat = statOf(document.activeElement);
      if (!stat) return;
      event.preventDefault();
      const { me: now, dust: dustNow, plan: current, applying: busy } = latest.current;
      if (busy) return;
      if (planTotal(current) > 0) {
        sound.play('confirm');
        applyPlan();
        return;
      }
      if (now.stats[stat] >= MAX_STAT) {
        showPadNote(`${STAT_INFO[stat].label} is already at its highest.`);
        sound.play('error');
        return;
      }
      if (dustNow < upgradeCost(now.level)) {
        showPadNote('Not enough Binary Dust to raise this.');
        sound.play('error');
        return;
      }
      sound.play('confirm');
      queue.current = [stat];
      sendNext();
    };

    const onBack = (event: Event) => {
      event.preventDefault();
      if (charactersBack.current?.()) return;
      if (clearPlan()) return;
      const active = document.activeElement;
      if (active && bodyRef.current?.contains(active)) {
        const on = tabsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (on) {
          padFocus(on);
          sound.play('hover');
          return;
        }
      }
      latest.current.onStand();
    };

    const onFocus = () => {
      const active = document.activeElement;
      if (!active || !root.contains(active)) setZone('none');
      else if (tabsRef.current?.contains(active)) setZone('tabs');
      else if (active.closest('[data-stat]')) setZone('stat');
      else if (active.closest('.grace-save__confirm')) setZone('confirm');
      else if (active.closest('.grace-travel')) setZone('travel');
      else if (active.closest('.grace-menu__stand')) setZone('stand');
      else setZone('body');
    };

    root.addEventListener('padadjust', onAdjust);
    root.addEventListener('padback', onBack);
    root.addEventListener('focusin', onFocus);
    window.addEventListener('padnav', onNav);
    onFocus();
    return () => {
      root.removeEventListener('padadjust', onAdjust);
      root.removeEventListener('padback', onBack);
      root.removeEventListener('focusin', onFocus);
      window.removeEventListener('padnav', onNav);
    };
  }, [applyPlan, clearPlan, sendNext]);

  const hereName = findGrace(MAP.graces, grace)?.name ?? 'Binary Grace';
  const planCost = costOf(me.level, planned);

  return (
    <aside
      ref={rootRef}
      className={`grace-menu${tab === 'travel' ? ' grace-menu--wide' : ''}`}
      aria-label="Binary Grace"
      data-pad-scope="grace"
    >
      <header className="grace-menu__head">
        <h1>{hereName}</h1>
        <p className="grace-menu__rested">Rested. Health, magic, stamina and potions are full, and you will come back here if you fall.</p>
        <p className="grace-menu__dust">
          <BinaryDust /> <strong>{dust.toLocaleString()}</strong> Binary Dust
          {planned > 0 && <span className="grace-menu__dust-plan">after the plan: {(dust - planCost).toLocaleString()}</span>}
        </p>
      </header>
      <nav ref={tabsRef} className="grace-menu__tabs">
        {TABS.map(({ id, label }, index) => (
          <button
            key={id}
            ref={index === 0 ? first : undefined}
            type="button"
            className={`grace-menu__tab${tab === id ? ' grace-menu__tab--on' : ''}`}
            aria-pressed={tab === id}
            data-pad-tab
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="grace-menu__tab" data-pad-y onClick={onOpenMap}>World map</button>
      </nav>
      <div ref={bodyRef} className="grace-menu__content">
        {tab === 'upgrade' && (
          <UpgradeTab
            me={me}
            dust={dust}
            plan={plan}
            applying={applying}
            onUpgrade={onUpgrade}
            onApply={applyPlan}
            onClear={clearPlan}
          />
        )}
        {tab === 'travel' && <TravelTab view={view} lit={lit} here={grace} onTravel={onTravel} />}
        {tab === 'characters' && <CharactersTab pendingRef={charactersBack} />}
      </div>
      <button type="button" className="btn btn--primary btn--block grace-menu__stand" onClick={onStand}>
        Stand up
      </button>
      <PadHints hints={hintsFor(tab, zone, planned)} />
    </aside>
  );
}
