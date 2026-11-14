import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { parseSlot } from '../../../shared/graces';
import {
  APPEARANCE_LIMITS,
  CLASSES,
  DEFAULT_APPEARANCE,
  STAT_INFO,
  STAT_KEYS,
  findClass,
  type Appearance,
  type ClassId,
} from '../../../shared/classes';
import { api } from '../api';
import { Divider, Sigil } from '../components/Ornaments';
import { CharacterStage, type StageHandle } from '../game/CharacterStage';
import { appearanceOptions, classDefaults, CLASS_PICTURE_ICON, type AppearanceOption } from '../game/characters';
import { Icon } from '../components/Icon';
import { useSession } from '../session';
import { sound } from '../sound';
import { PadGlyph, useInputDevice } from '../components/InputGlyph';
import { isPadDevice } from '../game/inputDevice';
import { PadHints, type PadHint } from '../ui/PadHints';
import { padFocus, type PadNavDetail } from '../ui/padNav';
import '../styles/site-pad.css';

const MAX_STAT = 20;

type Step = 'class' | 'customize';

function StatBars({ classId }: { classId: ClassId }) {
  const stats = findClass(classId)!.baseStats;
  return (
    <ul className="stat-bars">
      {STAT_KEYS.map((key) => (
        <li key={key} title={STAT_INFO[key].effect}>
          <span className="stat-bars__label">{STAT_INFO[key].label}</span>
          <span className="stat-bars__track">
            <span style={{ width: `${(stats[key] / MAX_STAT) * 100}%` }} />
          </span>
          <span className="stat-bars__value">{stats[key]}</span>
        </li>
      ))}
    </ul>
  );
}

function OptionRow({
  option,
  value,
  onChange,
  isDefault,
}: {
  option: AppearanceOption;
  value: number;
  onChange: (value: number) => void;
  isDefault: boolean;
}) {
  const count = Math.min(APPEARANCE_LIMITS[option.key], option.choices.length);
  const row = useRef<HTMLFieldSetElement>(null);
  const pad = useInputDevice() !== 'keyboard';
  // The latest value and setter, for the listener added once below.
  const latest = useRef({ value, onChange, count });
  latest.current = { value, onChange, count };

  // With a controller the whole row is one item: left and right step through its choices.
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const onAdjust = (event: Event) => {
      const { step } = (event as CustomEvent<{ step: -1 | 1 }>).detail;
      const { value: current, onChange: change, count: total } = latest.current;
      if (total < 2) return;
      event.preventDefault();
      change((current + step + total) % total);
      sound.play('hover');
    };
    element.addEventListener('padadjust', onAdjust);
    return () => element.removeEventListener('padadjust', onAdjust);
  }, []);

  return (
    <fieldset
      ref={row}
      className="option"
      data-pad-item
      data-pad-adjust
      data-pad-noscale
      data-pad-default={isDefault || undefined}
      aria-label={pad ? `${option.label}, choice ${value + 1} of ${count}` : undefined}
    >
      <legend>
        {option.label}
        {pad && <span className="option__count">{value + 1} / {count}</span>}
      </legend>
      {/* The buttons stay for the mouse and keyboard; the controller uses the row instead. */}
      <div className="option__choices" data-pad-skip>
        {Array.from({ length: count }, (_, index) => {
          const choice = option.choices[index];
          const swatch = option.isColor ? choice : null;
          return (
            <button
              key={index}
              type="button"
              className={swatch ? 'swatch' : 'chip'}
              aria-pressed={value === index}
              aria-label={swatch ? `${option.label} ${index + 1}` : undefined}
              style={swatch ? { backgroundColor: swatch } : undefined}
              onClick={() => onChange(index)}
            >
              {swatch ? '' : choice}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const CLASS_HINTS: PadHint[] = [
  { button: 'dpadUpDown', label: 'Choose class' },
  { button: 'confirm', label: 'Continue' },
  { button: 'tabs', label: 'Step' },
  { button: 'back', label: 'Back' },
];

const CUSTOMIZE_HINTS: PadHint[] = [
  { button: 'dpadUpDown', label: 'Move' },
  { button: 'adjust', label: 'Change' },
  { button: 'y', label: 'Save and Play' },
  { button: 'tabs', label: 'Step' },
  { button: 'back', label: 'Class' },
];

export default function CreatePage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  // A new character from the grace menu names its save. The server checks this again.
  const slot = parseSlot(Number(search.get('slot'))) ?? undefined;
  const { user, refresh } = useSession();
  const stage = useRef<StageHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const pad = useInputDevice() !== 'keyboard';
  const [step, setStep] = useState<Step>('class');
  const [classId, setClassId] = useState<ClassId>('duelist');
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Coming back to edit starts from what the player already has.
  useEffect(() => {
    api.character(slot).then(
      ({ character }) => {
        if (character) {
          setClassId(character.classId as ClassId);
          setAppearance(character.appearance);
          setIsEditing(true);
        }
      },
      () => undefined,
    );
  }, [slot]);

  const definition = findClass(classId)!;

  const chooseClass = (id: ClassId) => {
    setClassId(id);
    setAppearance((current) => ({ ...current, ...classDefaults(id) }));
    stage.current?.showOff();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveCharacter(classId, appearance, slot);
      await refresh();
      sound.play('gate');
      navigate('/play');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your character couldn't be saved.");
      sound.play('error');
      setSaving(false);
      // The button was disabled while saving, which drops the controller's highlight.
      if (isPadDevice()) requestAnimationFrame(() => primary.current && padFocus(primary.current));
    }
  };

  // With a controller, changing step puts the highlight on the first thing of the new step.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (!isPadDevice() || !root.current) return;
    const target = root.current.querySelector<HTMLElement>(
      step === 'class' ? '.class-card[aria-checked="true"]' : '.option[data-pad-item]',
    );
    if (target) padFocus(target);
  }, [step]);

  // Controller extras: the shoulder buttons switch step, and A on a class picks it and moves on.
  const latest = useRef({ step, chooseClass });
  latest.current = { step, chooseClass };
  useEffect(() => {
    const onPad = (event: Event) => {
      const { action, scope } = (event as CustomEvent<PadNavDetail>).detail;
      if (!root.current || scope !== root.current) return;
      const active = document.activeElement as HTMLElement | null;
      if (action === 'tabPrev' || action === 'tabNext') {
        event.preventDefault();
        const next: Step = action === 'tabNext' ? 'customize' : 'class';
        if (next !== latest.current.step) {
          sound.play('page');
          setStep(next);
        }
      } else if (action === 'confirm' && active?.matches('.class-card')) {
        event.preventDefault();
        const id = active.dataset.classId as ClassId;
        if (id) latest.current.chooseClass(id);
        sound.play('confirm');
        setStep('customize');
      } else if (action === 'confirm' && active?.matches('.option[data-pad-item]')) {
        // A on a row of choices steps to the next one, the same as right.
        event.preventDefault();
        active.dispatchEvent(new CustomEvent('padadjust', { detail: { step: 1 }, bubbles: true, cancelable: true }));
      }
    };
    window.addEventListener('padnav', onPad);
    return () => window.removeEventListener('padnav', onPad);
  }, []);

  return (
    <div className="create" ref={root} data-pad-scope="create">
      <CharacterStage ref={stage} classId={classId} appearance={appearance} className="create__stage" />

      <header className="create__top">
        <Link to="/" className="brand" aria-label="CSE Souls home">
          <Sigil />
          <span className="brand__word">CSE Souls</span>
        </Link>
        <ol className="create__steps">
          {pad && <li className="create__step-glyph" aria-hidden="true"><PadGlyph button="lb" /></li>}
          <li data-active={step === 'class'}>1. Class</li>
          <li data-active={step === 'customize'}>2. Appearance</li>
          {pad && <li className="create__step-glyph" aria-hidden="true"><PadGlyph button="rb" /></li>}
        </ol>
        <p className="create__player">{user?.username}</p>
      </header>

      <aside className="create__panel create__panel--left">
        {step === 'class' ? (
          <>
            <h1>Choose your class</h1>
            <p className="create__hint">
              {isEditing ? 'You can change this for now, while the game is in early development.' : 'This decides your starting stats and weapon.'}
            </p>
            <Divider />
            <div className="class-list" role="radiogroup" aria-label="Class">
              {CLASSES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={item.id === classId}
                  className="class-card"
                  data-class-id={item.id}
                  data-pad-default={item.id === classId || undefined}
                  onClick={() => chooseClass(item.id)}
                  // With a controller, moving over a class shows it, like arrow keys in a radio group.
                  onFocus={() => {
                    if (isPadDevice() && item.id !== classId) chooseClass(item.id);
                  }}
                >
                  <span className="class-card__icon"><Icon name={CLASS_PICTURE_ICON[item.id]} /></span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.weaponType}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1>Customize your {definition.name}</h1>
            <Divider />
            <div className="options">
              {appearanceOptions(classId, appearance).map((option, index) => (
                <OptionRow
                  key={option.key}
                  option={option}
                  value={appearance[option.key]}
                  isDefault={index === 0}
                  onChange={(value) => setAppearance((current) => ({ ...current, [option.key]: value }))}
                />
              ))}
            </div>
          </>
        )}
      </aside>

      <aside className="create__panel create__panel--right">
        <h2>{definition.name}</h2>
        <p className="create__weapon">{definition.weaponType}</p>
        <p className="create__summary">{definition.summary}</p>
        <Divider />
        <h3>Starting stats</h3>
        <StatBars classId={classId} />
        <p className="create__note">Raise these later with Binary Dust, earned by killing enemies and animals.</p>
      </aside>

      <footer className="create__actions">
        {!pad && <p className="create__drag">Drag to turn your character</p>}
        {error && <p className="form__error" role="alert">{error}</p>}
        <div className="create__buttons">
          {step === 'class' ? (
            <>
              <Link key="leave" className="btn btn--ghost btn--large" to="/" data-pad-back>Back</Link>
              <button
                key="next"
                ref={primary}
                type="button"
                className="btn btn--primary btn--large"
                data-pad-y
                onClick={() => setStep('customize')}
              >
                Next: Appearance
              </button>
            </>
          ) : (
            <>
              <button key="back" type="button" className="btn btn--ghost btn--large" data-pad-back onClick={() => setStep('class')}>
                Back
              </button>
              <button
                key="save"
                ref={primary}
                type="button"
                className="btn btn--primary btn--large"
                data-pad-y
                disabled={saving}
                onClick={save}
              >
                {saving ? 'Saving…' : 'Save and Play'}
              </button>
            </>
          )}
        </div>
      </footer>
      <PadHints hints={step === 'class' ? CLASS_HINTS : CUSTOMIZE_HINTS} />
    </div>
  );
}
