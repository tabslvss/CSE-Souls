import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LeaderboardEntry, type LeaderboardSort } from '../api';
import { Avatar } from '../components/Avatar';
import { Panel, SectionHeading } from '../components/Ornaments';
import { useSession } from '../session';

const PAGE_SIZE = 25;

const TABS: Array<{ key: LeaderboardSort; label: string }> = [
  { key: 'boss_kills', label: 'Boss kills' },
  { key: 'boss_damage', label: 'Boss damage' },
  { key: 'kills', label: 'Total kills' },
  { key: 'level', label: 'Level' },
];

export function LeaderboardPage() {
  const { user } = useSession();
  const [sort, setSort] = useState<LeaderboardSort>('boss_kills');
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    api.leaderboard(sort, PAGE_SIZE, offset).then(
      (result) => {
        if (!active) return;
        setEntries(result.entries);
        setTotal(result.total);
      },
      (err: Error) => active && setError(err.message),
    );
    return () => {
      active = false;
    };
  }, [sort, offset]);

  return (
    <div className="page page--narrow">
      <SectionHeading title="Leaderboard">
        Every registered player, online or not.
      </SectionHeading>
      <div className="tabs" role="tablist" aria-label="Rank players by">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={sort === tab.key}
            className="tabs__tab"
            onClick={() => {
              setSort(tab.key);
              setOffset(0);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Panel>
        {error && <p className="form__error" role="alert">{error}</p>}
        {!error && entries === null && <p className="muted center">Loading…</p>}
        {!error && entries?.length === 0 && (
          <p className="muted center">No players yet. You could be the first.</p>
        )}
        {!error && !!entries?.length && (
          <div className="table-scroll">
            <table className="ranks">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Level</th>
                  <th scope="col" className="num">Boss kills</th>
                  <th scope="col" className="num">Boss damage</th>
                  <th scope="col" className="num">Total kills</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.username} data-self={entry.username === user?.username} data-rank={entry.rank}>
                    <td className="ranks__rank">{entry.rank}</td>
                    <td>
                      <Link to={`/players/${entry.username}`} className="ranks__player">
                        <Avatar url={entry.avatarUrl} name={entry.username} size={32} />
                        {entry.username}
                      </Link>
                    </td>
                    <td className="num">{entry.level}</td>
                    <td className="num">{entry.bossKills.toLocaleString()}</td>
                    <td className="num">{entry.bossDamage.toLocaleString()}</td>
                    <td className="num">{entry.kills.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="pager">
            <button
              type="button"
              className="btn btn--small"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span className="muted">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <button
              type="button"
              className="btn btn--small"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
