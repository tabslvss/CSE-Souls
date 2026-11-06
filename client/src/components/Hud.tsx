import { artUrl } from '../art';
import type { InputDevice } from '../game/inputDevice';
import { Icon } from './Icon';
import { ActionGlyph, hasGlyph, useInputDevice, type InputAction } from './InputGlyph';

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

/** Only what really works in the game right now. The pause menu shows this same list. */
const CONTROLS: Array<{ action: InputAction; label: string; padLabel?: string }> = [
  { action: 'move', label: 'Move' },
  { action: 'look', label: 'Look around' },
  { action: 'run', label: 'Run', padLabel: 'Run (hold)' },
  { action: 'jump', label: 'Jump' },
  { action: 'roll', label: 'Dodge roll', padLabel: 'Dodge roll (tap)' },
  { action: 'attack', label: 'Attack' },
  { action: 'lock', label: 'Lock on to an enemy' },
  { action: 'potion', label: 'Drink a healing potion' },
  { action: 'interact', label: 'Open a chest' },
  { action: 'zoom', label: 'Camera distance' },
  { action: 'pause', label: 'Pause' },
];

/** The rows for this device. Actions with no button on it are left out. */
export function controlsFor(device: InputDevice): Array<{ action: InputAction; label: string }> {
  return CONTROLS.filter(({ action }) => hasGlyph(action, device)).map(({ action, label, padLabel }) => ({
    action,
    label: device === 'keyboard' ? label : padLabel ?? label,
  }));
}

export function ControlsList() {
  const device = useInputDevice();
  return (
    <dl className="controls">
      {controlsFor(device).map(({ action, label }) => (
        <div key={action} className="controls__row">
          <dt>
            <ActionGlyph action={action} />
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}
