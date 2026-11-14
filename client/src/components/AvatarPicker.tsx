import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, ApiError, type AvatarOptions, type AvatarResult } from '../api';
import { sound } from '../sound';
import { Icon } from './Icon';
import { useInputDevice } from './InputGlyph';
import { isPadDevice } from '../game/inputDevice';
import { PadHints, type PadHint } from '../ui/PadHints';
import { padFocus } from '../ui/padNav';
import '../styles/site-pad.css';

type Tab = 'emblems' | 'generated' | 'github' | 'upload';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'emblems', label: 'Icons' },
  { id: 'generated', label: 'Random' },
  { id: 'github', label: 'GitHub' },
  { id: 'upload', label: 'Upload' },
];

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const GENERATED_COUNT = 12;

const BASE_HINTS: PadHint[] = [
  { button: 'dpad', label: 'Move' },
  { button: 'confirm', label: 'Use' },
  { button: 'tabs', label: 'Source' },
  { button: 'back', label: 'Close' },
];

const GENERATED_HINTS: PadHint[] = [...BASE_HINTS.slice(0, 2), { button: 'x', label: 'Shuffle' }, ...BASE_HINTS.slice(2)];

/** Random seeds, so nothing about the player is sent to the avatar service. */
function randomSeeds(): string[] {
  return Array.from({ length: GENERATED_COUNT }, () =>
    Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  );
}

export function AvatarPicker({
  onDone,
  onClose,
}: {
  onDone: (result: AvatarResult) => void | Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>('emblems');
  const [options, setOptions] = useState<AvatarOptions | null>(null);
  const [styleId, setStyleId] = useState('pixel-art');
  const [seeds, setSeeds] = useState(randomSeeds);
  const [githubLogin, setGithubLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useInputDevice() !== 'keyboard';
  const body = useRef<HTMLDivElement>(null);
  /** The tile last pressed, to give the controller its highlight back if that fails. */
  const pressed = useRef<HTMLElement | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    api.avatarOptions().then(setOptions, (err: Error) => setError(err.message));
  }, []);

  // The browser focuses the close button on opening. With a controller, the first picture is a
  // better start, once the pictures have loaded.
  useEffect(() => {
    if (!options || !isPadDevice()) return;
    const active = document.activeElement;
    if (active && body.current?.contains(active)) return;
    const first = body.current?.querySelector<HTMLElement>('.picker__tile');
    if (first) padFocus(first);
  }, [options]);

  // Pictures are disabled while one is being applied, which drops the highlight. Put it back.
  useEffect(() => {
    if (busy || !isPadDevice()) return;
    const target = pressed.current;
    const active = document.activeElement;
    if (target?.isConnected && (!active || active === document.body || active === dialog.current)) padFocus(target);
  }, [busy]);

  const style = useMemo(() => options?.styles.find((item) => item.id === styleId), [options, styleId]);

  const apply = async (work: () => Promise<AvatarResult>) => {
    pressed.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setError(null);
    try {
      await onDone(await work());
      sound.play('confirm');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
      sound.play('error');
      setBusy(false);
    }
  };

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Choose a JPG, PNG or GIF image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Images can be at most 5 MB.');
      return;
    }
    void apply(() => api.uploadAvatar(file));
  };

  const onGitHubSubmit = (event: FormEvent) => {
    event.preventDefault();
    void apply(() => api.useGitHubAvatar(githubLogin.trim()));
  };

  return (
    <dialog ref={dialog} className="picker" onClose={onClose} aria-labelledby="picker-title" data-pad-scope="picker">
      <header className="picker__header">
        <h2 id="picker-title">Choose your profile picture</h2>
        <button type="button" className="picker__close" onClick={onClose} aria-label="Close" data-pad-back>
          &times;
        </button>
      </header>

      <div className="tabs tabs--left" role="tablist" aria-label="Picture source">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className="tabs__tab"
            data-pad-tab
            onClick={() => {
              setTab(item.id);
              setError(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <p className="form__error" role="alert">{error}</p>}

      <div className="picker__body" aria-busy={busy} ref={body} data-pad-default>
        {tab === 'emblems' && (
          <ul className="picker__grid">
            {options?.emblems.map((emblem) => (
              <li key={emblem}>
                <button
                  type="button"
                  className="picker__tile"
                  disabled={busy}
                  onClick={() => void apply(() => api.useEmblem(emblem))}
                  aria-label={`Use the ${emblem.replaceAll('-', ' ')} icon`}
                >
                  <Icon name={emblem} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab === 'generated' && (
          <>
            <div className="picker__styles">
              {options?.styles.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="chip"
                  aria-pressed={item.id === styleId}
                  onClick={() => setStyleId(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <button type="button" className="chip chip--action" data-pad-x
                onClick={() => {
                  // New pictures replace the old ones. If one of them had the highlight, it moves to the first.
                  const onTile = document.activeElement?.matches('.picker__tile') ?? false;
                  setSeeds(randomSeeds());
                  if (onTile) {
                    requestAnimationFrame(() => {
                      const first = body.current?.querySelector<HTMLElement>('.picker__tile');
                      if (first) padFocus(first);
                    });
                  }
                }}
              >
                Shuffle
              </button>
            </div>
            <ul className="picker__grid">
              {style &&
                seeds.map((seed) => (
                  <li key={seed}>
                    <button
                      type="button"
                      className="picker__tile picker__tile--image"
                      disabled={busy}
                      onClick={() => void apply(() => api.useGeneratedAvatar(styleId, seed))}
                      aria-label="Use this avatar"
                    >
                      <img src={`${style.previewUrl}${seed}`} alt="" loading="lazy" width={96} height={96} />
                    </button>
                  </li>
                ))}
            </ul>
            <p className="field__hint">These pictures come from DiceBear.</p>
          </>
        )}

        {tab === 'github' && (
          <form className="form" onSubmit={onGitHubSubmit}>
            {pad && <p className="pad-tip">Typing a GitHub username needs a keyboard.</p>}
            <div className="field">
              <label htmlFor="github-login">GitHub username</label>
              <input
                id="github-login"
                value={githubLogin}
                onChange={(event) => setGithubLogin(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={39}
                required
              />
              <p className="field__hint">Uses the public profile picture on that GitHub account.</p>
            </div>
            <button className="btn btn--primary" disabled={busy || !githubLogin.trim()}>
              {busy ? 'Getting picture…' : 'Use GitHub Picture'}
            </button>
          </form>
        )}

        {tab === 'upload' && (
          <div className="picker__upload">
            {pad && <p className="pad-tip">Choosing a file from your computer needs a mouse or keyboard.</p>}
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif" hidden onChange={onFileChosen} />
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? 'Uploading…' : 'Choose an Image'}
            </button>
            <p className="field__hint">JPG, PNG or GIF, up to 5 MB. It gets cropped to a square, never stretched.</p>
          </div>
        )}
      </div>
      {/* Inline, because the open picker sits above the site's own hint bar. */}
      <PadHints placement="inline" hints={tab === 'generated' ? GENERATED_HINTS : BASE_HINTS} />
    </dialog>
  );
}
