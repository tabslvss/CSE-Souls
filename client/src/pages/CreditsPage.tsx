import { TEAM } from '../components/Layout';
import { Panel, SectionHeading } from '../components/Ornaments';

const MUSIC = ['Night Vigil', 'Ancient Rite'];

const ICON_AUTHORS = ['Lorc', 'Delapouite', 'Skoll', 'DarkZaitzev', 'Caro Asercion'];

function External({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

export function CreditsPage() {
  return (
    <div className="page page--narrow">
      <SectionHeading title="Credits" />
      <Panel className="credits">
        <h2 className="panel-title">Made by</h2>
        <ul className="credits__team">
          {TEAM.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="center muted">CSE 312 team project, University at Buffalo.</p>

        <h2 className="panel-title">Music</h2>
        <ul>
          {MUSIC.map((track) => (
            <li key={track}>
              “{track}” by Kevin MacLeod (<External href="https://incompetech.com">incompetech.com</External>).
              Licensed under{' '}
              <External href="https://creativecommons.org/licenses/by/4.0/">Creative Commons: By Attribution 4.0</External>.
              Compressed for the web, with a short fade added at each end.
            </li>
          ))}
        </ul>

        <h2 className="panel-title">Sound effects</h2>
        <p>
          Most sounds were generated with <External href="https://elevenlabs.io/terms-of-use">ElevenLabs</External> Sound
          Effects for this project, then edited. Footsteps and some hits use{' '}
          <External href="https://kenney.nl/assets/impact-sounds">Impact Sounds</External> and{' '}
          <External href="https://kenney.nl/assets/rpg-audio">RPG Audio</External> by Kenney, released under CC0.
        </p>

        <h2 className="panel-title">Website art</h2>
        <p>Generated with ChatGPT for this project.</p>

        <h2 className="panel-title">Characters and animations</h2>
        <p>
          Character models, outfits and animations by{' '}
          <External href="https://quaternius.com">Quaternius</External>, released under CC0.
        </p>

        <h2 className="panel-title">Weapons</h2>
        <p>
          <External href="https://amos-makes.itch.io/psx-weapon-pack">PSX Weapon Pack</External> by Amos and{' '}
          <External href="https://cardinalzebra.itch.io/low-poly-fantasy-weapon-pack">LowPoly Fantasy Weapon Pack</External>{' '}
          by CardinalZebra, both released under CC0.
        </p>

        <h2 className="panel-title">Animals</h2>
        <p>
          <External href="https://quaternius.com/packs/ultimateanimatedanimals.html">Ultimate Animated Animal Pack</External>{' '}
          by Quaternius, released under CC0.
        </p>

        <h2 className="panel-title">Forest</h2>
        <ul>
          <li>
            PSX+ Forest by ju5t1nj <External href="https://ju5t1nj.itch.io/">https://ju5t1nj.itch.io/</External>, under
            Creative Commons Attribution (<External href="https://ju5t1nj.itch.io/psx-plus-forest-pack">pack page</External>).
            Converted, rescaled and darkened.
          </li>
          <li>
            <External href="https://godgoldfear.itch.io/low-poly-dead-trees">Low Poly dead trees</External> by godgoldfear,
            under <External href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</External>. Converted, rescaled and
            darkened.
          </li>
          <li>
            <External href="https://quaternius.itch.io/stylized-nature-megakit">Stylized Nature MegaKit</External> by Quaternius
            and <External href="https://kenney.nl/assets/nature-kit">Nature Kit</External> by Kenney, released under CC0.
          </li>
        </ul>

        <h2 className="panel-title">Castle and ruins</h2>
        <p>
          <External href="https://quaternius.com/packs/ultimatemodularruins.html">Ultimate Modular Ruins Pack</External>,{' '}
          <External href="https://quaternius.itch.io/fantasy-props-megakit">Fantasy Props MegaKit</External> and{' '}
          <External href="https://quaternius.itch.io/medieval-village-megakit">Medieval Village MegaKit</External> by Quaternius,{' '}
          <External href="https://chilly-durango.itch.io/medieval-building-parts">3D Retro Medieval/Fantasy Building Kit</External>{' '}
          by chilly_durango, and <External href="https://kenney.nl/assets/castle-kit">Castle Kit 2.0</External> by Kenney, all
          released under CC0.
        </p>

        <h2 className="panel-title">Ground and particles</h2>
        <p>
          <External href="https://screamingbrainstudios.itch.io/tiny-texture-pack">Tiny Texture Pack 1</External> by Screaming
          Brain Studios, and <External href="https://kenney.nl/assets/retro-textures-fantasy">Retro Textures Fantasy</External>,{' '}
          <External href="https://kenney.nl/assets/particle-pack">Particle Pack</External> and{' '}
          <External href="https://kenney.nl/assets/smoke-particles">Smoke Particles</External> by Kenney, all released under CC0.
        </p>

        <h2 className="panel-title">Icons</h2>
        <p>
          Icons made by {ICON_AUTHORS.join(', ')}. Available on{' '}
          <External href="https://game-icons.net">game-icons.net</External>, under{' '}
          <External href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</External>. Recolored for this site.
        </p>
        <p>
          Button pictures from <External href="https://kenney.nl/assets/input-prompts">Input Prompts</External> by Kenney,
          released under CC0.
        </p>

        <h2 className="panel-title">Services</h2>
        <ul>
          <li>
            Random profile pictures from <External href="https://www.dicebear.com">DiceBear</External>.
          </li>
          <li>
            Password breach warnings from{' '}
            <External href="https://haveibeenpwned.com/Passwords">Have I Been Pwned</External>.
          </li>
          <li>Profile picture import from GitHub.</li>
        </ul>

        <h2 className="panel-title">Fonts</h2>
        <p>Cinzel and EB Garamond, under the SIL Open Font License.</p>
      </Panel>
    </div>
  );
}
