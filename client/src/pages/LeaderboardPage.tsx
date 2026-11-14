import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LeaderboardEntry, type LeaderboardSort } from '../api';
import { Avatar } from '../components/Avatar';
import { Panel, SectionHeading } from '../components/Ornaments';
import { isPadDevice } from '../game/inputDevice';
import { useSession } from '../session';
import { PadHints, type PadHint } from '../ui/PadHints';
import { padFocus, type PadNavDetail } from '../ui/padNav';

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
  const pager = useRef<HTMLDivElement>(null);
  const paged = total > PAGE_SIZE;

  // The triggers turn the page, like the Previous and Next buttons.
  const latest = useRef({ offset, total });
  latest.current = { offset, total };
  useEffect(() => {
    const onPad = (event: Event) => {
      const { action, scope } = (event as CustomEvent<PadNavDetail>).detail;
      if (action !== 'lt' && action !== 'rt') return;
      // Only for the page itself, not a dialog open on top of it.
      if (scope && scope.dataset.padScope !== 'site') return;
      const { offset: current, total: count } = latest.current;
      const next = action === 'rt' ? current + PAGE_SIZE : current - PAGE_SIZE;
      if (next < 0 || next >= count) return;
      event.preventDefault();
      setOffset(next);
    };
    window.addEventListener('padnav', onPad);
    return () => window.removeEventListener('padnav', onPad);
  }, []);

  // Reaching the first or last page disables the button just pressed, which drops the controller's
  // highlight. Hand it to the other one.
  const pagerPressed = useRef(false);
  useEffect(() => {
    if (!pagerPressed.current) return;
    pagerPressed.current = false;
    if (!isPadDevice()) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const other = pager.current?.querySelector<HTMLElement>('button:not(:disabled)');
    if (other) padFocus(other);
  }, [offset]);

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
            data-pad-tab
            data-pad-default={sort === tab.key || undefined}
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
        {paged && (
          <div className="pager" ref={pager}>
            <button
              type="button"
              className="btn btn--small"
              disabled={offset === 0}
              onClick={() => {
                pagerPressed.current = true;
                setOffset(Math.max(0, offset - PAGE_SIZE));
              }}
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
              onClick={() => {
                pagerPressed.current = true;
                setOffset(offset + PAGE_SIZE);
              }}
            >
              Next
            </button>
          </div>
        )}
      </Panel>
      <PadHints
        hints={[
          { button: 'dpad', label: 'Move' },
          { button: 'confirm', label: 'View player' },
          { button: 'tabs', label: 'Rank by' },
          ...(paged ? [{ button: 'triggers', label: 'Page' } satisfies PadHint] : []),
          { button: 'scroll', label: 'Scroll' },
          { button: 'back', label: 'Back' },
        ]}
      />
    </div>
  );
}
