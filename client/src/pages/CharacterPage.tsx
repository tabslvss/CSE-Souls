import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type AvatarResult, type Player } from '../api';
import { AvatarPicker } from '../components/AvatarPicker';
import { CharacterSheet } from '../components/CharacterSheet';
import { announceAchievement } from '../components/toast';
import { useSession } from '../session';
import { sound } from '../sound';

export function CharacterPage() {
  const { setAvatar } = useSession();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlayer(await api.profile());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Your character couldn't be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onAvatarChanged = async (result: AvatarResult) => {
    setAvatar(result.avatarUrl);
    result.unlocked.forEach(announceAchievement);
    await load();
  };

  const onRemove = async () => {
    setBusy(true);
    setRemoveError(null);
    try {
      await api.removeAvatar();
      setAvatar(null);
      await load();
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "The picture couldn't be removed.");
      sound.play('error');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div className="page"><p className="form__error" role="alert">{loadError}</p></div>;
  if (!player) return <div className="page-loading" role="status">Loading…</div>;

  return (
    <div className="page">
      <CharacterSheet
        player={player}
        portraitActions={
          <div className="portrait-actions">
            <Link className="btn btn--primary btn--small" to="/create">
              {player.classId ? 'Edit Character' : 'Create Character'}
            </Link>
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => setPickerOpen(true)}>
              Change Picture
            </button>
            {player.avatarUrl && (
              <button type="button" className="text-button" disabled={busy} onClick={onRemove}>
                Remove picture
              </button>
            )}
            {removeError && <p className="form__error" role="alert">{removeError}</p>}
          </div>
        }
      />
      {pickerOpen && <AvatarPicker onDone={onAvatarChanged} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
