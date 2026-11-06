import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Achievement } from '../api';
import { AchievementGlyph } from '../components/AchievementGlyph';
import { Panel, SectionHeading } from '../components/Ornaments';
import { useSession } from '../session';

export function AchievementsPage() {
  const { user, loading } = useSession();
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    api.achievements().then(
      (result) => setAchievements(result.achievements),
      (err: Error) => setError(err.message),
    );
  }, [loading, user?.username]);

  const earned = achievements?.filter((item) => item.unlockedAt).length ?? 0;

  return (
    <div className="page">
      <SectionHeading title="Achievements">
        {user ? (
          `You've earned ${earned} of ${achievements?.length ?? '–'}.`
        ) : (
          <>
            <Link to="/login">Log in</Link> to see which ones you've earned.
          </>
        )}
      </SectionHeading>
      {error && <p className="form__error center" role="alert">{error}</p>}
      <ul className="deeds">
        {achievements?.map((item) => (
          <li key={item.id}>
            <Panel className="deed">
              <div data-unlocked={!!item.unlockedAt} className="deed__inner">
                <AchievementGlyph id={item.id} unlocked={!!item.unlockedAt} />
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  <p className="deed__status">
                    {item.unlockedAt
                      ? `Unlocked ${new Date(item.unlockedAt).toLocaleDateString()}`
                      : 'Locked'}
                    {typeof item.holders === 'number' && (
                      <span>
                        {' · '}
                        {item.holders === 1 ? '1 player has this' : `${item.holders.toLocaleString()} players have this`}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
