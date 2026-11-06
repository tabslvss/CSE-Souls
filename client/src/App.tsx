import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AchievementsPage } from './pages/AchievementsPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CharacterPage } from './pages/CharacterPage';
import { CreditsPage } from './pages/CreditsPage';
import { HomePage } from './pages/HomePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlayerPage } from './pages/PlayerPage';
import { useSession } from './session';

// Three.js is large, so it only downloads when someone actually opens the game.
const GamePage = lazy(() => import('./pages/GamePage'));
const CreatePage = lazy(() => import('./pages/CreatePage'));

const LOADING = <div className="page-loading" role="status">Loading…</div>;

function RequireLogin({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const { pathname } = useLocation();
  if (loading) return LOADING;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />;
  return children;
}

export function App() {
  return (
    <Suspense fallback={LOADING}>
      <Routes>
        <Route path="play" element={<RequireLogin><GamePage /></RequireLogin>} />
        <Route path="create" element={<RequireLogin><CreatePage /></RequireLogin>} />
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="achievements" element={<AchievementsPage />} />
          <Route path="players/:username" element={<PlayerPage />} />
          <Route path="credits" element={<CreditsPage />} />
          <Route path="character" element={<RequireLogin><CharacterPage /></RequireLogin>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
