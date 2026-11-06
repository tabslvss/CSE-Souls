import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
}: {
  option: AppearanceOption;
  value: number;
  onChange: (value: number) => void;
}) {
  const count = Math.min(APPEARANCE_LIMITS[option.key], option.choices.length);
  return (
    <fieldset className="option">
      <legend>{option.label}</legend>
      <div className="option__choices">
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

export default function CreatePage() {
  const navigate = useNavigate();
  const { user, refresh } = useSession();
  const stage = useRef<StageHandle>(null);
  const [step, setStep] = useState<Step>('class');
  const [classId, setClassId] = useState<ClassId>('duelist');
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Coming back to edit starts from what the player already has.
  useEffect(() => {
    api.character().then(
      ({ character }) => {
        if (character) {
          setClassId(character.classId as ClassId);
          setAppearance(character.appearance);
          setIsEditing(true);
        }
      },
      () => undefined,
    );
  }, []);

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
      await api.saveCharacter(classId, appearance);
      await refresh();
      sound.play('gate');
      navigate('/play');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your character couldn't be saved.");
      sound.play('error');
      setSaving(false);
    }
  };

  return (
    <div className="create">
      <CharacterStage ref={stage} classId={classId} appearance={appearance} className="create__stage" />

      <header className="create__top">
        <Link to="/" className="brand" aria-label="CSE Souls home">
          <Sigil />
          <span className="brand__word">CSE Souls</span>
        </Link>
        <ol className="create__steps">
          <li data-active={step === 'class'}>1. Class</li>
          <li data-active={step === 'customize'}>2. Appearance</li>
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
                  onClick={() => chooseClass(item.id)}
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
              {appearanceOptions(classId, appearance).map((option) => (
                <OptionRow
                  key={option.key}
                  option={option}
                  value={appearance[option.key]}
                  onChange={(value) => setAppearance({ ...appearance, [option.key]: value })}
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
        <p className="create__drag">Drag to turn your character</p>
        {error && <p className="form__error" role="alert">{error}</p>}
        <div className="create__buttons">
          {step === 'class' ? (
            <>
              <Link className="btn btn--ghost btn--large" to="/">Back</Link>
              <button type="button" className="btn btn--primary btn--large" onClick={() => setStep('customize')}>
                Next: Appearance
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--ghost btn--large" onClick={() => setStep('class')}>
                Back
              </button>
              <button type="button" className="btn btn--primary btn--large" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save and Play'}
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
