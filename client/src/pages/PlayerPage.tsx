import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Player } from '../api';
import { CharacterSheet } from '../components/CharacterSheet';

export function PlayerPage() {
  const { username = '' } = useParams();
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlayer(null);
    setError(null);
    api.player(username).then(setPlayer, (err: Error) => setError(err.message));
  }, [username]);

  if (error) {
    return (
      <div className="page center">
        <p className="lede">{error}</p>
        <Link className="btn btn--small" to="/leaderboard">Back to Leaderboard</Link>
      </div>
    );
  }
  if (!player) return <div className="page-loading" role="status">Loading…</div>;
  return (
    <div className="page">
      <CharacterSheet player={player} />
    </div>
  );
}
