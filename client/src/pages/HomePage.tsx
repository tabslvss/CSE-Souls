import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LeaderboardEntry, type RealmStatus } from '../api';
import { artUrl } from '../art';
import { CLASSES, type ClassId } from '../../../shared/classes';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { ControlsList, HudPreview } from '../components/Hud';
import { Divider, Panel, Reveal, SectionHeading } from '../components/Ornaments';
import { HeroScene } from '../scene/HeroScene';
import { Vignette, type VignetteKind } from '../scene/Vignette';
import { timeOfDayName, worldPhase } from '../scene/worldClock';
import { useSession } from '../session';

const CLASS_ICONS: Record<ClassId, string> = {
  juggernaut: 'battle-axe',
  duelist: 'katana',
  arcanist: 'wizard-staff',
  ranger: 'bow-arrow',
};

const AREAS: Array<{ kind: VignetteKind; name: string; text: string; art: string }> = [
  {
    kind: 'village',
    name: 'Forsaken Village',
    text: 'The starting area. Learn to fight against weak undead in the ruins.',
    art: 'land-village',
  },
  {
    kind: 'forest',
    name: 'Cursed Forest',
    text: 'Hunt deer and wolves to earn XP and level up.',
    art: 'land-forest',
  },
  {
    kind: 'graveyard',
    name: 'Sunken Graveyard',
    text: 'Skeleton archers attack from a distance, so keep moving.',
    art: 'land-graveyard',
  },
  {
    kind: 'citadel',
    name: 'Fallen Citadel',
    text: 'Armored knights guard the best loot in the game.',
    art: 'land-citadel',
  },
  {
    kind: 'throne',
    name: 'Throne of Ash',
    text: 'The boss arena. Everyone who gets here fights together.',
    art: 'land-throne',
  },
];

const ATTACKS = [
  ['Cleave', 'A wide sword swing that hits everyone up close.'],
  ['Ground Rupture', 'A shockwave spreads across the floor. Get out of the way.'],
  ['Ashen Charge', 'It picks one player and rushes straight at them.'],
];

const FEATURES = [
  ['Binary Dust', 'Kill enemies and animals to collect Binary Dust, then spend it to raise your stats.'],
  ['Better weapons', 'Every class starts with a basic weapon. Find and loot stronger versions as you explore.'],
  ['Healing potions', 'You carry three. Refill them by resting at a bonfire.'],
  ['Day and night', 'Every player shares the same day and night cycle.'],
  ['Play together', 'Everyone online is in the same world, in real time.'],
];

function useServerStats(): RealmStatus | null {
  const [status, setStatus] = useState<RealmStatus | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      api.realm().then(
        (result) => active && setStatus(result),
        () => undefined,
      );
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  return status;
}

function StatsStrip() {
  const status = useServerStats();
  const [timeOfDay, setTimeOfDay] = useState(() => timeOfDayName(worldPhase()));
  useEffect(() => {
    const timer = window.setInterval(() => setTimeOfDay(timeOfDayName(worldPhase())), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <dl className="stats-strip">
      <div>
        <dt>In-game time</dt>
        <dd>{timeOfDay}</dd>
      </div>
      <div>
        <dt>Players online</dt>
        <dd>{status ? status.online.toLocaleString() : '–'}</dd>
      </div>
      <div>
        <dt>Registered players</dt>
        <dd>{status ? status.registered.toLocaleString() : '–'}</dd>
      </div>
      <div>
        <dt>Boss kills</dt>
        <dd>{status ? status.bossKills.toLocaleString() : '–'}</dd>
      </div>
    </dl>
  );
}

function TopPlayers() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  useEffect(() => {
    api.leaderboard('boss_kills', 5, 0).then(
      (result) => setEntries(result.entries),
      () => setEntries([]),
    );
  }, []);

  if (entries === null) return <p className="muted center">Loading…</p>;
  if (entries.length === 0) {
    return <p className="muted center">No players yet. You could be the first.</p>;
  }
  return (
    <ol className="top-list">
      {entries.map((entry) => (
        <li key={entry.username}>
          <span className="top-list__rank">{entry.rank}</span>
          <Avatar url={entry.avatarUrl} name={entry.username} size={40} />
          <Link to={`/players/${entry.username}`} className="top-list__name">{entry.username}</Link>
          <span className="top-list__stat">
            {entry.bossKills.toLocaleString()} <small>boss kills</small>
          </span>
          <span className="top-list__stat top-list__stat--optional">Level {entry.level}</span>
        </li>
      ))}
    </ol>
  );
}

export function HomePage() {
  const { user } = useSession();
  const logo = artUrl('logo');

  return (
    <>
      <section className="hero">
        <HeroScene className="hero__scene" />
        <div className="hero__veil" />
        <div className="hero__content">
          <p className="eyebrow hero__eyebrow">A co-op dark fantasy RPG you play in your browser</p>
          {logo ? (
            <h1 className="hero__logo"><img src={logo} alt="CSE Souls" /></h1>
          ) : (
            <h1 className="hero__title"><span>CSE Souls</span></h1>
          )}
          <Divider className="hero__divider" />
          <p className="hero__tagline">
            Explore a fallen kingdom, level up, and defeat the final boss with other players.
          </p>
          <div className="hero__actions">
            {user ? (
              <>
                <Link className="btn btn--primary btn--large" to="/play">Play Now</Link>
                <Link className="btn btn--large" to="/character">My Character</Link>
              </>
            ) : (
              <>
                <Link className="btn btn--primary btn--large" to="/register">Create Account</Link>
                <Link className="btn btn--large" to="/login">Log In</Link>
              </>
            )}
          </div>
        </div>
        <StatsStrip />
      </section>

      <section className="section">
        <SectionHeading eyebrow="Classes" title="Choose how you fight">
          Four classes, each with its own weapon and starting stats. Customize how yours looks.
        </SectionHeading>
        <ul className="classes">
          {CLASSES.map((item, index) => (
            <Reveal as="li" key={item.id} delay={index * 70} className="class-tile">
              {artUrl(`class-${item.id}`) ? (
                <img className="class-tile__art" src={artUrl(`class-${item.id}`)} alt="" loading="lazy" />
              ) : (
                <span className="class-tile__icon"><Icon name={CLASS_ICONS[item.id]} /></span>
              )}
              <h3>{item.name}</h3>
              <p className="class-tile__weapon">{item.weaponType}</p>
              <p>{item.summary}</p>
            </Reveal>
          ))}
        </ul>
      </section>

      <section className="section section--world">
        <SectionHeading eyebrow="The World" title="Five areas. One final boss.">
          One connected world, shared with every player online.
        </SectionHeading>
        <ol className="areas">
          {AREAS.map((area, index) => (
            <Reveal as="li" key={area.kind} delay={index * 70} className="area">
              <Vignette kind={area.kind} art={area.art} />
              <span className="area__number">{index + 1}</span>
              <div className="area__caption">
                <h3>{area.name}</h3>
                <p>{area.text}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      <section className="section section--boss">
        <div className="boss">
          <Reveal className="boss__art">
            <Vignette kind="sovereign" art="boss-sovereign" />
          </Reveal>
          <Reveal className="boss__text">
            <p className="eyebrow">The Final Boss</p>
            <h2>The Ashen Sovereign</h2>
            <p className="lede">
              Every player in the world fights the same boss at the same time, and its health bar
              goes down for everyone. When it dies, everyone sees who took part and who dealt the
              most damage.
            </p>
            <ul className="attacks">
              {ATTACKS.map(([name, text]) => (
                <li key={name}>
                  <strong>{name}</strong>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <p className="boss__warning">At half health, it gets faster.</p>
          </Reveal>
        </div>
        <Reveal className="bossbar">
          <p className="bossbar__name">The Ashen Sovereign</p>
          <div className="bossbar__track"><span /></div>
        </Reveal>
      </section>

      <section className="section">
        <SectionHeading eyebrow="Gameplay" title="How it plays">
          The game is still in development. Right now you can create a character and explore the world
          with other players. The rest is coming soon.
        </SectionHeading>
        <div className="gameplay">
          <Reveal>
            <ul className="features">
              {FEATURES.map(([name, text]) => (
                <li key={name}>
                  <h3>{name}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal>
            <Panel className="gameplay__panel">
              <HudPreview />
              <Divider />
              <ControlsList />
            </Panel>
          </Reveal>
        </div>
      </section>

      <section className="section section--top">
        <SectionHeading eyebrow="Leaderboard" title="Top players" />
        <Reveal className="top">
          <Panel>
            <TopPlayers />
            <div className="center top__more">
              <Link className="btn btn--small" to="/leaderboard">See Full Leaderboard</Link>
            </div>
          </Panel>
        </Reveal>
      </section>

      <section className="closing">
        <p className="closing__line">Ready to play?</p>
        <Link className="btn btn--primary btn--large" to={user ? '/play' : '/register'}>
          {user ? 'Play Now' : 'Create Account'}
        </Link>
      </section>
    </>
  );
}
