import { artUrl } from '../art';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GameClient, type HudState } from '../game/GameClient';
import type { ConnectionStatus } from '../game/net';
import { BinaryDust } from '../components/BinaryDust';
import { Icon } from '../components/Icon';
import { useSession } from '../session';

const STATUS_MESSAGE: Partial<Record<ConnectionStatus, string>> = {
  connecting: 'Connecting to the server…',
  lost: 'Connection lost. Reconnecting…',
  replaced: 'You opened the game in another tab, so this one has stopped.',
  expired: 'Your login has run out. Taking you to log in…',
};

export function GamePage() {
  const { user, loading, refresh } = useSession();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GameClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [locked, setLocked] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [dust, setDust] = useState(0);

  const hasCharacter = !!user?.hasCharacter;

  useEffect(() => {
    if (!loading && user && !hasCharacter) navigate('/create', { replace: true });
  }, [loading, user, hasCharacter, navigate]);

  useEffect(() => {
    if (!hasCharacter || !canvasRef.current || !plateRef.current) return;
    const client = new GameClient(canvasRef.current, plateRef.current, {
      onStatus: (next) => {
        if (next === 'no_character') {
          navigate('/create', { replace: true });
          return;
        }
        setStatus(next);
        // If the login has run out, this clears it and the page sends the player to log in.
        if (next === 'lost' || next === 'expired') void refresh();
      },
      onHud: setHud,
      onPointerLock: setLocked,
      onBinaryDust: setDust,
    });
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      client.dispose();
    };
  }, [hasCharacter, navigate, refresh]);

  const message = STATUS_MESSAGE[status];
  const staminaShare = hud ? (hud.stamina / hud.maxStamina) * 100 : 100;

  return (
    <div className="game">
      <canvas ref={canvasRef} className="game__canvas" aria-label="Game world" />
      <div ref={plateRef} className="game__plates" />

      <div className="game__hud">
        <div className="game__vitals">
          <div className="game__flask">
            {artUrl('icon-flask') ? <img src={artUrl('icon-flask')} alt="" /> : <Icon name="health-potion" />}
            <span>3</span>
          </div>
          <div className="game__bars">
            <div className="bar bar--health bar--tall" title="Health">
              <span style={{ width: '100%' }} />
            </div>
            <div className="bar bar--magic" title="Magic">
              <span style={{ width: '100%' }} />
            </div>
            <div className="bar bar--stamina" title="Stamina">
              <span style={{ width: `${staminaShare}%`, transition: 'width 0.12s linear' }} />
            </div>
          </div>
        </div>

        <div className="game__dust" title="Binary Dust. Spend it to raise your stats.">
          <BinaryDust />
          <strong>{dust.toLocaleString()}</strong>
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

      {!locked && status === 'open' && (
        <div className="game__menu">
          <div className="game__menu-card">
            <h1>Paused</h1>
            <button type="button" className="btn btn--primary btn--large" onClick={() => clientRef.current?.requestPointerLock()}>
              Click to Play
            </button>
            <dl className="game__keys">
              <div><dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>Move</dd></div>
              <div><dt><kbd>Mouse</kbd></dt><dd>Look around</dd></div>
              <div><dt><kbd>Shift</kbd></dt><dd>Run</dd></div>
              <div><dt><kbd>Space</kbd></dt><dd>Dodge</dd></div>
              <div><dt><kbd>Left click</kbd></dt><dd>Attack</dd></div>
              <div><dt><kbd>Scroll</kbd></dt><dd>Camera distance</dd></div>
              <div><dt><kbd>Esc</kbd></dt><dd>Pause</dd></div>
            </dl>
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
