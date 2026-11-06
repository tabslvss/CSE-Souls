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
        <p>Generated with ElevenLabs for this project, then edited.</p>

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

        <h2 className="panel-title">Icons</h2>
        <p>
          Icons made by {ICON_AUTHORS.join(', ')}. Available on{' '}
          <External href="https://game-icons.net">game-icons.net</External>, under{' '}
          <External href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</External>. Recolored for this site.
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
