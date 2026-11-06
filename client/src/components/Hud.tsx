import { artUrl } from '../art';
import { Icon } from './Icon';

/** A preview of the in-game display: health, magic and stamina, with healing potions beside them. */
export function HudPreview() {
  return (
    <div className="hud" role="img" aria-label="In-game display showing health, magic and stamina bars and three healing potions">
      <div className="hud__flask">
        {artUrl('icon-flask') ? <img src={artUrl('icon-flask')} alt="" /> : <Icon name="health-potion" />}
        <span className="hud__count">3</span>
      </div>
      <div className="hud__bars">
        <div className="bar-row"><span>Health</span><div className="bar bar--health"><span style={{ width: '82%' }} /></div></div>
        <div className="bar-row"><span>Magic</span><div className="bar bar--magic"><span style={{ width: '58%' }} /></div></div>
        <div className="bar-row"><span>Stamina</span><div className="bar bar--stamina"><span style={{ width: '91%' }} /></div></div>
      </div>
    </div>
  );
}

const CONTROLS: Array<[string[], string]> = [
  [['W', 'A', 'S', 'D'], 'Move'],
  [['Mouse'], 'Look around'],
  [['Shift'], 'Run'],
  [['Space'], 'Dodge'],
  [['Left click'], 'Attack'],
  [['Right click'], 'Block'],
  [['Q'], 'Use healing potion'],
  [['E'], 'Interact'],
];

export function ControlsList() {
  return (
    <dl className="controls">
      {CONTROLS.map(([keys, action]) => (
        <div key={action} className="controls__row">
          <dt>
            {keys.map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </dt>
          <dd>{action}</dd>
        </div>
      ))}
    </dl>
  );
}
