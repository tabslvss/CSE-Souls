import { artUrl } from '../art';
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GameClient, type BossHud, type HudState } from '../game/GameClient';
import type { ConnectionStatus } from '../game/net';
import { BinaryDust } from '../components/BinaryDust';
import { controlsFor } from '../components/Hud';
import { GraceMenu } from '../components/GraceMenu';
import { Icon } from '../components/Icon';
import { ActionGlyph, useInputDevice } from '../components/InputGlyph';
import { WorldMap, WorldMapLegend } from '../components/WorldMap';
import { getInputDevice } from '../game/inputDevice';
import { useSession } from '../session';
import { PadHints, type PadHint } from '../ui/PadHints';
import '../styles/game-pad.css';

const STATUS_MESSAGE: Partial<Record<ConnectionStatus, string>> = {
  connecting: 'Connecting to the server…',
  lost: 'Connection lost. Reconnecting…',
  replaced: 'You opened the game in another tab, so this one has stopped.',
  expired: 'Your login has run out. Taking you to log in…',
};

const BANNER_MS = 2600;

/* The controller hint bars for each in-game screen. Nothing shows while playing. */
const PAUSE_HINTS: PadHint[] = [
  { button: 'dpad', label: 'Move' },
  { button: 'confirm', label: 'Select' },
  { button: 'back', label: 'Resume' },
  { button: 'select', label: 'World map' },
];
/** A fallback: the grace menu can show its own bar (at priority 0 or more), which then replaces this. */
const GRACE_HINTS: PadHint[] = [
  { button: 'dpad', label: 'Move' },
  { button: 'confirm', label: 'Select' },
  { button: 'back', label: 'Back' },
  { button: 'select', label: 'World map' },
];
const MAP_HINTS: PadHint[] = [
  { button: 'dpad', label: 'Move' },
  { button: 'confirm', label: 'Select' },
  { button: 'back', label: 'Close map' },
];
/** The map can open over the grace menu, so its bar sits above anything the grace menu shows. */
const MAP_HINTS_PRIORITY = 2;
const GRACE_HINTS_PRIORITY = -0.5;

/**
 * Circle/B on a controller (ui/padNav.ts) sends 'padback' to the open screen's scope. This runs onBack for it.
 * A component inside may mark its own nested scope, and then the event goes to that one and does not bubble:
 * the capture listener catches it on the way down and runs onBack after the nested scope's own listeners,
 * only if none of them handled it.
 */
function usePadBack(ref: RefObject<HTMLElement | null>, open: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    const scope = ref.current;
    if (!open || !scope) return;
    const run = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      latest.current();
    };
    const capture = (event: Event) => {
      if (event.target !== scope && event.target) event.target.addEventListener('padback', run, { once: true });
    };
    scope.addEventListener('padback', run);
    scope.addEventListener('padback', capture, { capture: true });
    return () => {
      scope.removeEventListener('padback', run);
      scope.removeEventListener('padback', capture, { capture: true });
    };
  }, [ref, open]);
}
const NOTICE_MS = 3600;

function share(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}

/** Health has a pale chip behind its fill, which lags behind so you can see what a blow just cost. */
function Bar({ kind, title, percent, tall }: { kind: string; title: string; percent: number; tall?: boolean }) {
  return (
    <div className={`bar bar--${kind}${tall ? ' bar--tall' : ''} bar--game`} title={title}>
      {kind === 'health' && <span className="bar__chip" style={{ width: `${percent}%` }} />}
      <span className="bar__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * The boss's name and health along the bottom of the screen, above your own bars. Under the health, a thin
 * stance bar fills as hits build up. When it breaks it flashes and then shows the stun running out, with the
 * critical hit prompt while you stand where an attack would land one.
 */
function BossBar({ boss }: { boss: BossHud }) {
  const percent = Math.max(0, Math.min(100, boss.share));
  const stance = Math.max(0, Math.min(100, boss.stunned ? boss.stun : boss.stance));
  return (
    <div className={`boss-hud${boss.fading ? ' boss-hud--fading' : ''}`} role="group" aria-label={`${boss.name}, ${Math.round(percent)} percent health`}>
      <p className="boss-hud__name">{boss.name}</p>
      <div className="boss-hud__track">
        <span className="boss-hud__chip" style={{ width: `${percent}%` }} />
        <span className="boss-hud__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className={`boss-hud__stance${boss.stunned ? ' boss-hud__stance--broken' : ''}`} title="Stance">
        <span className="boss-hud__stance-fill" style={{ width: `${stance}%` }} />
        {boss.breaks > 0 && <span key={boss.breaks} className="boss-hud__stance-flash" />}
      </div>
      {boss.stunned && (
        <p className={`boss-hud__crit${boss.critReady ? ' boss-hud__crit--ready' : ''}`} role="status">
          {boss.critReady ? <><ActionGlyph action="attack" /> Critical hit</> : 'Stance broken. Get close to its head.'}
        </p>
      )}
    </div>
  );
}

/**
 * A checkbox setting. On a controller the whole row is the item, so the highlight frames the words as well
 * as the box, and pressing it flips the setting without sending focus into the little box. A mouse click or
 * the keyboard work on the checkbox as usual.
 */
function SettingToggle({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label
      data-pad-item
      className={checked ? 'is-on' : undefined}
      onClick={(event) => {
        // A controller's press is a click with no mouse behind it, aimed at the row itself.
        if (event.detail !== 0 || event.target !== event.currentTarget) return;
        event.preventDefault();
        onChange(!checked);
      }}
    >
      <input type="checkbox" data-pad-skip checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
      <span className="game__setting-state" aria-hidden="true">{checked ? 'On' : 'Off'}</span>
    </label>
  );
}

export function GamePage() {
  const { user, loading, refresh } = useSession();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const device = useInputDevice();
  const clientRef = useRef<GameClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [locked, setLocked] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [dust, setDust] = useState(0);
  const dustRef = useRef<HTMLElement>(null);
  const [banner, setBanner] = useState<{ key: number; title: string; detail: string } | null>(null);
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [vhsOn, setVhsOn] = useState(true);
  const [reduceShake, setReduceShake] = useState(false);
  /** The grace you're sitting at, by the server's word, or 0. */
  const [graceId, setGraceId] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  // The game's callbacks live as long as the game does, so they read these and not the state above.
  const graceRef = useRef(0);
  const mapRef = useRef(false);
  const graceElement = useRef<HTMLDivElement>(null);
  const mapElement = useRef<HTMLDivElement>(null);
  const graceBack = useRef<(() => boolean) | null>(null);
  /** Whether the game was being played when the map opened, so closing it goes back to where you were. */
  const mapFromPlay = useRef(false);
  const lockedRef = useRef(false);

  const showMap = useCallback((open: boolean) => {
    mapRef.current = open;
    setMapOpen(open);
  }, []);

  const showGrace = useCallback((grace: number) => {
    graceRef.current = grace;
    setGraceId(grace);
  }, []);

  /**
   * The map closes back to the grace menu if you're sitting, and otherwise back to the game. On a controller,
   * a map opened from the pause card closes back to the pause card.
   */
  const toggleMap = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    if (mapRef.current) {
      showMap(false);
      // The keyboard keeps its old behaviour, where closing the map always goes back to playing.
      if (graceRef.current === 0) client.closeOverlay(mapFromPlay.current || getInputDevice() === 'keyboard');
    } else {
      mapFromPlay.current = lockedRef.current;
      showMap(true);
      client.openOverlay();
    }
  }, [showMap]);

  const standUp = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    client.standUp();
    showGrace(0);
    client.closeOverlay(true);
  }, [showGrace]);

  /**
   * Backing out one step, from Circle/B (through padNav), Options/Menu (through the game's onMenu) and Esc:
   * the map first, then the grace menu's own submenus, then standing up, and from the pause card back to play.
   */
  const backOut = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    if (mapRef.current) toggleMap();
    else if (graceRef.current > 0) {
      if (!graceBack.current?.()) standUp();
    } else if (menuRef.current) client.playWithController();
  }, [standUp, toggleMap]);

  const hasCharacter = !!user?.hasCharacter;

  useEffect(() => {
    if (!loading && user && !hasCharacter) navigate('/create', { replace: true });
  }, [loading, user, hasCharacter, navigate]);

  useEffect(() => {
    if (!hasCharacter || !canvasRef.current || !plateRef.current) return;
    let bannerTimer = 0;
    let noticeTimer = 0;
    const client = new GameClient(canvasRef.current, plateRef.current, {
      onStatus: (next) => {
        if (next === 'no_character') {
          navigate('/create', { replace: true });
          return;
        }
        setStatus(next);
        // Whatever these were showing is gone, and a reconnect starts standing in a new world state.
        if (next !== 'open') {
          showGrace(0);
          showMap(false);
          clientRef.current?.closeOverlay(false);
        }
        // If the login has run out, this clears it and the page sends the player to log in.
        if (next === 'lost' || next === 'expired') void refresh();
      },
      onHud: setHud,
      onPointerLock: (next) => {
        lockedRef.current = next;
        setLocked(next);
      },
      onBinaryDust: (amount, pulse) => {
        setDust(amount);
        if (pulse) dustRef.current?.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.45)', color: '#ff8a6a' }, { transform: 'scale(1)' }],
          { duration: 320, easing: 'ease-out' },
        );
      },
      onBanner: (title, detail) => {
        window.clearTimeout(bannerTimer);
        setBanner({ key: performance.now(), title, detail });
        bannerTimer = window.setTimeout(() => setBanner(null), BANNER_MS);
      },
      onNotice: (text) => {
        window.clearTimeout(noticeTimer);
        setNotice({ key: performance.now(), text });
        noticeTimer = window.setTimeout(() => setNotice(null), NOTICE_MS);
      },
      onRest: (grace) => {
        showGrace(grace);
        if (grace > 0) clientRef.current?.openOverlay();
        else if (!mapRef.current) clientRef.current?.closeOverlay(true);
      },
      onMapKey: toggleMap,
      // Only 'back' comes now: Options/Menu with a menu open, or Esc with an overlay open. Moving around
      // the menus, pressing and Circle/B all belong to the site's controller layer (ui/padNav.ts).
      onMenu: backOut,
    });
    clientRef.current = client;
    setVhsOn(client.vhsOn);
    setReduceShake(client.reduceShake);
    return () => {
      window.clearTimeout(bannerTimer);
      window.clearTimeout(noticeTimer);
      clientRef.current = null;
      client.dispose();
    };
  }, [backOut, hasCharacter, navigate, refresh, showGrace, showMap, standUp, toggleMap]);

  const message = STATUS_MESSAGE[status];
  const dead = !!hud && hud.deadSeconds > 0;
  const graceShown = graceId > 0 && !!hud?.me && status === 'open';
  const mapShown = mapOpen && status === 'open';
  const pauseShown = !locked && status === 'open' && graceId === 0 && !mapOpen;
  usePadBack(graceElement, graceShown, backOut);
  usePadBack(mapElement, mapShown, backOut);
  usePadBack(menuRef, pauseShown, backOut);

  /** A mouse click asks for pointer lock. A controller (or the keyboard, while a controller is in use) needs none. */
  const play = (event: MouseEvent) => {
    const client = clientRef.current;
    if (!client) return;
    if (event.detail === 0 && getInputDevice() !== 'keyboard') client.playWithController();
    else client.requestPointerLock();
  };
  const mapView = useCallback(() => clientRef.current?.mapView() ?? { me: null, others: [] }, []);

  return (
    <div className="game">
      <canvas ref={canvasRef} className="game__canvas" aria-label="Game world" />
      <div ref={plateRef} className="game__plates" />

      <div className="game__hud">
        <div className="game__vitals">
          <div className="game__flask">
            {artUrl('icon-flask') ? <img src={artUrl('icon-flask')} alt="" /> : <Icon name="health-potion" />}
            <span>{hud ? hud.potions : 3}</span>
          </div>
          <div className="game__bars">
            <Bar kind="health" title="Health" tall percent={hud ? share(hud.health, hud.maxHealth) : 100} />
            <Bar kind="magic" title="Magic" percent={hud ? share(hud.magic, hud.maxMagic) : 100} />
            <Bar kind="stamina" title="Stamina" percent={hud ? share(hud.stamina, hud.maxStamina) : 100} />
          </div>
        </div>

        {hud?.boss && <BossBar boss={hud.boss} />}

        <div className="game__dust" title="Binary Dust. Spend it to raise your stats.">
          <BinaryDust />
          <strong ref={dustRef} data-testid="dust">{dust.toLocaleString()}</strong>
        </div>

        <div className="game__online">
          <p>
            {hud ? `${hud.online} ${hud.online === 1 ? 'player' : 'players'} online` : 'Connecting…'}
            {hud && hud.ping > 0 && <small> · {hud.ping} ms delay</small>}
          </p>
          {hud && (
            <ul>
              {hud.names.slice(0, 8).map((name) => (
                <li key={name}>{name}</li>
              ))}
              {hud.names.length > 8 && <li>and {hud.names.length - 8} more</li>}
            </ul>
          )}
        </div>
      </div>

      {message && (status === 'lost' || status === 'replaced') ? (
        // Nothing else on screen can be pressed while the game is stopped, so give a way out to the site.
        <div className="game__message game__message--stuck" role="status" data-pad-scope="stopped">
          <p>{message}</p>
          <Link to="/" className="btn btn--small" data-pad-default>Back to home</Link>
        </div>
      ) : (
        message && <p className="game__message" role="status">{message}</p>
      )}

      {hud?.prompt && locked && <p className="game__prompt">Press <ActionGlyph action="interact" /> {hud.prompt}</p>}
      {notice && <p key={notice.key} className="game__notice" role="status">{notice.text}</p>}
      {banner && !dead && (
        <div key={banner.key} className="game__banner" role="status">
          <strong>{banner.title}</strong>
          <small>{banner.detail}</small>
        </div>
      )}
      {dead && (
        <div className="game__death" role="status">
          <strong>Fallen</strong>
          <small>Back at your Binary Grace in {Math.max(1, Math.ceil(hud.deadSeconds))}</small>
        </div>
      )}

      {graceShown && hud?.me && (
        <div ref={graceElement} className="grace-screen" data-pad-scope="grace">
          <PadHints hints={GRACE_HINTS} priority={GRACE_HINTS_PRIORITY} />
          <GraceMenu
            grace={graceId}
            me={hud.me}
            dust={hud.dust}
            lit={hud.graces}
            view={mapView}
            backRef={graceBack}
            onUpgrade={(stat) => clientRef.current?.upgradeStat(stat)}
            onTravel={(grace) => clientRef.current?.travelTo(grace)}
            onOpenMap={toggleMap}
            onStand={standUp}
          />
        </div>
      )}

      {mapShown && (
        <div ref={mapElement} className="map-screen" data-pad-scope="map">
          <PadHints hints={MAP_HINTS} priority={MAP_HINTS_PRIORITY} />
          <div className="map-screen__card">
            <header className="map-screen__head">
              <h1>World Map</h1>
              <button type="button" className="btn btn--primary btn--small" onClick={toggleMap}>Close</button>
            </header>
            <WorldMap
              view={mapView}
              lit={hud?.graces ?? []}
              here={graceId > 0 ? graceId : undefined}
              onPick={graceId > 0 ? (grace) => clientRef.current?.travelTo(grace) : undefined}
            />
            <WorldMapLegend />
          </div>
        </div>
      )}

      {pauseShown && (
        <div className="game__menu">
          <PadHints hints={PAUSE_HINTS} />
          <div ref={menuRef} className="game__menu-card" data-pad-scope="pause">
            <h1>Paused</h1>
            <button type="button" className="btn btn--primary btn--large game__play" data-pad-default onClick={play}>
              {device === 'keyboard' ? 'Click to Play' : <>Press <ActionGlyph action="confirm" /> to Play</>}
            </button>
            <dl className="game__keys">
              {controlsFor(device).map(({ action, label }) => (
                <div key={action}>
                  <dt><ActionGlyph action={action} /></dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
            {/* On a controller the whole row is the item, so the highlight frames the words as well as the box. */}
            <div className="game__settings">
              <SettingToggle
                checked={vhsOn}
                onChange={(on) => {
                  clientRef.current?.setVhs(on);
                  setVhsOn(on);
                }}
              >
                VHS tape look
              </SettingToggle>
              <SettingToggle
                checked={reduceShake}
                onChange={(on) => {
                  clientRef.current?.setReduceShake(on);
                  setReduceShake(on);
                }}
              >
                Reduce camera shake
              </SettingToggle>
            </div>
            <div className="game__menu-links">
              <Link to="/create">Edit Character</Link>
              <Link to="/">Leave Game</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GamePage;
