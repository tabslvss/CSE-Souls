import { artUrl } from '../art';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GameClient, type HudState } from '../game/GameClient';
import type { ConnectionStatus } from '../game/net';
import { BinaryDust } from '../components/BinaryDust';
import { controlsFor } from '../components/Hud';
import { GraceMenu } from '../components/GraceMenu';
import { Icon } from '../components/Icon';
import { ActionGlyph, useInputDevice } from '../components/InputGlyph';
import { WorldMap, WorldMapLegend } from '../components/WorldMap';
import { useSession } from '../session';

const STATUS_MESSAGE: Partial<Record<ConnectionStatus, string>> = {
  connecting: 'Connecting to the server…',
  lost: 'Connection lost. Reconnecting…',
  replaced: 'You opened the game in another tab, so this one has stopped.',
  expired: 'Your login has run out. Taking you to log in…',
};

const BANNER_MS = 2600;
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

  const showMap = useCallback((open: boolean) => {
    mapRef.current = open;
    setMapOpen(open);
  }, []);

  const showGrace = useCallback((grace: number) => {
    graceRef.current = grace;
    setGraceId(grace);
  }, []);

  /** The map closes back to the grace menu if you're sitting, and otherwise back to the game. */
  const toggleMap = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    if (mapRef.current) {
      showMap(false);
      if (graceRef.current === 0) client.closeOverlay(true);
    } else {
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
      onPointerLock: setLocked,
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
      onMenu: (nav) => {
        const overlay = mapRef.current ? mapElement.current : graceRef.current > 0 ? graceElement.current : null;
        const card = overlay ?? menuRef.current;
        if (!card) return;
        const items = [...card.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input')];
        const current = items.indexOf(document.activeElement as HTMLElement);
        if (overlay) {
          if (nav === 'back') {
            if (mapRef.current) toggleMap();
            else if (!graceBack.current?.()) standUp();
          } else if (nav === 'confirm') {
            if (current >= 0) items[current].click();
            else items[0]?.focus();
          } else {
            const step = nav === 'down' ? 1 : -1;
            const target = items[current < 0 ? 0 : (current + step + items.length) % items.length];
            target?.focus();
            target?.scrollIntoView({ block: 'nearest' });
          }
          return;
        }
        if (nav === 'up' || nav === 'down') {
          const step = nav === 'down' ? 1 : -1;
          items[current < 0 ? 0 : (current + step + items.length) % items.length]?.focus();
        } else if (nav === 'back' || current <= 0) {
          // The first item is the Play button, which on a controller needs no pointer lock.
          client.playWithController();
        } else {
          items[current].click();
        }
      },
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
  }, [hasCharacter, navigate, refresh, showGrace, showMap, standUp, toggleMap]);

  // Only the first time it opens: the map has one button, and a controller needs it to have focus.
  useEffect(() => {
    if (mapOpen) mapElement.current?.querySelector('button')?.focus();
  }, [mapOpen]);

  const message = STATUS_MESSAGE[status];
  const dead = !!hud && hud.deadSeconds > 0;
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

      {message && <p className="game__message" role="status">{message}</p>}

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

      {graceId > 0 && hud?.me && status === 'open' && (
        <div ref={graceElement} className="grace-screen">
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

      {mapOpen && status === 'open' && (
        <div ref={mapElement} className="map-screen">
          <div className="map-screen__card">
            <h1>World Map</h1>
            <WorldMap view={mapView} lit={hud?.graces ?? []} here={graceId > 0 ? graceId : undefined} />
            <WorldMapLegend />
            <button type="button" className="btn btn--primary" onClick={toggleMap}>Close</button>
          </div>
        </div>
      )}

      {!locked && status === 'open' && graceId === 0 && !mapOpen && (
        <div className="game__menu">
          <div ref={menuRef} className="game__menu-card">
            <h1>Paused</h1>
            <button type="button" className="btn btn--primary btn--large" onClick={() => clientRef.current?.requestPointerLock()}>
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
            <div className="game__settings">
              <label>
                <input
                  type="checkbox"
                  checked={vhsOn}
                  onChange={(event) => {
                    clientRef.current?.setVhs(event.target.checked);
                    setVhsOn(event.target.checked);
                  }}
                />
                VHS tape look
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={reduceShake}
                  onChange={(event) => {
                    clientRef.current?.setReduceShake(event.target.checked);
                    setReduceShake(event.target.checked);
                  }}
                />
                Reduce camera shake
              </label>
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
