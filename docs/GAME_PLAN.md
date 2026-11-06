# CSE Souls: Game Plan

Written Nov 5, 2026, and updated later that day after the player character change. Deadline: **Dec 1, 2026, 9:00 AM**. Team: Tabshir Khandaker, Kristian Schuchman, Ryan Chan.

Every number here is a starting value that gets tuned in one place: `shared/combat.ts` and `shared/enemies.ts`. Playtests can change them. The plan's structure should not change without a reason.

Units: 1 u is about 1 meter, and a player character is about 1.75 u tall. Reach, aggro and arena numbers are in world units and do not scale with height, so they did not change when the characters did. On the map, +x is east, -z is north.

Class names: this plan uses the names players see, which are Juggernaut, Duelist, Mage and Ranger. The Mage's id in the code is still `arcanist`. The enemy is always written Skeleton Mage, so the two do not get mixed up.

The rules below come from a condensed read of <https://cse312.com/hw/project.html>. The page itself is the authority, so check exact wording there before relying on a detail.

## Do these first

These five things can cost more points than any game feature.

| # | Problem | Why it matters | Fix by |
|---|---|---|---|
| 1 | This project folder has no `.git` directory, so it is not a repository right now, because nobody has asked to commit yet. | The course grades commits on the default branch. No commits means 0 after adjustments, and a commit under someone else's name means you did not write that code. | Nov 6 |
| 2 | The site is not deployed. `README.md` still has a placeholder link. | Part of Objective 1. A deployment without valid HTTPS also makes the whole presentation 0. | Nov 8 |
| 3 | Attacks hit nothing. Players can only move and swing at air. | Objective 3 requires a latency-sensitive interaction beyond moving. | Nov 14 |
| 4 | Interest management is not built, so the code still sends every player to every client. The other half of this row, nginx limits refusing a lecture hall on one IP, was fixed on Nov 5 (section 8). | User Tests are 10 points. Estimated 220 to 264 Mbit/s at 200 players with the current snapshots (section 4.4). | Nov 14 for snapshots |
| 5 | Objective 4 is not confirmed with staff. | 20 points rest on a judgment call. | Ask by Nov 6 (draft in section 7) |

---

## 0. What exists today

Only described here, not re-planned.

| Area | What is built | Where |
|---|---|---|
| Accounts | Register, login, logout on a separate auth container. RS256 JWTs with `exp` (12 hours by default), XSRF tokens, bcrypt cost 12. | `server/src/auth`, `server/src/shared/jwt.ts` |
| Onboarding | `/create` with four classes (Juggernaut, Duelist, Mage, Ranger) and three starting weapon setups per class. Customization: body (male or female), skin, hair style, hair color, beard, clothing color, leather and armor color, hood, shoulder armor and starting weapon. | `shared/classes.ts`, `client/src/game/characters.ts`, `client/src/pages/CreatePage.tsx` |
| Multiplayer | `/play` is the real game, and the old placeholder page is gone. It runs on an empty map of radius 90 u. 30 Hz server ticks, 15 Hz JSON snapshots, client prediction, reconciliation, interpolation. | `shared/sim.ts`, `server/src/app/realtime.ts`, `client/src/game/net.ts` |
| Actions | Run, dodge and attack with stamina costs, and the matching animations. | `shared/sim.ts`, `client/src/game/characters.ts` |
| Look | Low-res render target, Bayer dithering, vertex snapping, 20 minute wall-clock day/night, gold UI. | `client/src/game/psxRenderer.ts`, `client/src/scene/worldClock.ts` |
| Player models | Normally proportioned humans by Quaternius (CC0), about 1.75 u tall: Universal Base Characters and Modular Character Outfits - Fantasy, free tier, so Ranger and Peasant outfits, male and female bodies, and hair. All parts sit on one 65-bone skeleton in `kit-male.glb` and `kit-female.glb`. They replaced the KayKit players, which the user rejected as cartoony. | `client/public/models`, `client/src/game/characters.ts` |
| Animations | 42 clips from Quaternius Universal Animation Library 1 and 2 (CC0), on the same skeleton. | `client/public/models/anim-1.glb`, `anim-2.glb` |
| Weapons | 17 models from PSX Weapon Pack by Amos and LowPoly Fantasy Weapon Pack by CardinalZebra (both CC0), including a real longbow. | `client/public/models/weapons.glb` |
| Model build | One script rebuilds all of the above from the raw packs, which stay out of the repo. | `tools/build-models.mjs` |
| Data | `player_profiles` already has `level`, `xp`, `binary_dust` and six stats. `player_stats` and achievements exist, including `first_blood`, `boss_slayer` and `unbroken`. Gameplay does not write to them yet. | `server/migrations/001_init.sql` |
| nginx | Static paths skip the request limit, and `worker_connections` is 8,192 (section 8). | `nginx/nginx.conf`, `nginx/snippets/` |
| Security | The fixes from the security review are listed in section 4.10. | `server/src`, `nginx/` |
| Tests | `server/test` has 76 passing tests. Two real browser players were verified seeing each other on port 8080 with security headers on. | `server/test` |
| Load | 60 simulated players: app container about 6% CPU on this laptop, 14.8 snapshots per second per client, 41 KB/s down per client, no disconnects. All of it ran on one machine, so it does not measure real network conditions (section 6). | Script not in the project folder yet |

Not built yet: interest management, so snapshots still send every player to every client (section 4.4).

Gaps found while reading this code, which this plan closes:

- The Ranger's starting weapons (longbow, shortbow, spear) do not match the Longbow and Crossbow families in section 1.3, and the game has no crossbow model. This one is an open decision (section 1.3).
- `client/src/components/Hud.tsx` already lists right click as Block, Q as potion and E as interact. None of them do anything yet.
- `HudState` has `maxHealth` but no current health, and `SimState` has no health or magic.
- `grave_walker` ("Defeat 25 undead") has no matching counter in `player_stats`.

Facts checked from the files rather than assumed:

- `anim-1.glb` (24 clips) and `anim-2.glb` (18 clips) use the same skeleton as the kits. `Consume` suits potions, `Chest_Open` suits looting, and the `Zombie_*` clips suit undead enemies. The kept clips have no sit, lie-down, crawl or cheer animation, and the plan below works around that (section 5.1 has the full clip map).
- The skeleton uses UE-mannequin bone names (`root`, `pelvis`, `spine_01` ... `hand_r`, `hand_l`). `characters.ts` attaches weapons to `hand_r` and `hand_l`.
- `server/src/shared/db.ts` applies new files in `server/migrations` by name order, so `002_game.sql` needs no extra setup.

---

## 1. Game rules

### 1.1 Stats

Max health, max stamina and walk speed already exist in `deriveStats`, and the rest is new. Every stat starts at the class value in `shared/classes.ts`, and the cap is **40**.

| Stat | Formula | Example at creation |
|---|---|---|
| Health | Max health = 60 + 6 x Health | Juggernaut 156, Duelist 120, Ranger 114, Mage 108 |
| Stamina | Max stamina = 70 + 3 x Stamina. Regen per second = 22 + 0.3 x (Stamina - 10), after the existing 0.7 s delay. | Juggernaut 109, Ranger 103, Duelist 106, Mage 100 |
| Speed | Walk = 3 + 0.07 x (Speed - 10) u/s. Run = walk x 1.75. Attack time = base time / (1 + 0.01 x (Speed - 10)). | Ranger walks 3.42, runs 5.98. Juggernaut walks 2.79, runs 4.88. |
| Strength | Scales axe and hammer damage. Stagger power x (1 + 0.01 x (Strength - 10)) for every weapon. | |
| Dexterity | Scales sword, katana, bow and crossbow damage. Dodge invulnerability = 0.22 + 0.004 x Dexterity seconds of the 0.5 s dodge. | Ranger 0.288 s, Juggernaut 0.248 s |
| Arcane | Scales staff and wand damage. Max magic = 40 + 4 x Arcane. Magic regen per second = 3 + 0.2 x Arcane. | Mage 116 magic at 6.8/s. Juggernaut 60 at 4.0/s. |

Class base totals differ (61 to 69). Leave them. Balance is checked on damage per second below, and those numbers land close together.

### 1.2 Damage

```
statBonus = max(0.7, 1 + (governingStat - 10) x tierScale)
raw       = familyBase x tierMult x statBonus x attackMod x jointStrike
final     = max(1, round(raw x (1 - targetArmor)))
```

- `governingStat` is Strength for axe and hammer, Dexterity for sword, katana, longbow and crossbow, and Arcane for staff and wand.
- `attackMod` is 1, or the listed multiplier for a special.
- `jointStrike` is 1.2 if a different player hit the same target within the last 0.6 s, otherwise 1. This is one of the Objective 3 interactions.
- Spells count target armor at half value.
- There are no critical hits and no random damage. This keeps server results easy to test.

### 1.3 Weapon families

Each family changes numbers, not controls. The last two columns are measured at creation stats, including the class's Speed.

| Class | Family | Base dmg | Base time (s) | Cost | Reach or range | Shape | Max targets | Stagger | Rusted hit / DPS | Sovereign hit / DPS |
|---|---|---|---|---|---|---|---|---|---|---|
| Juggernaut | Great Axe | 40 | 1.10 | 24 stamina | 3.0 u | 140 deg arc | 5 | 40 | 50 / 44 | 134 / 119 |
| Juggernaut | War Hammer | 46 | 1.25 | 30 stamina | 2.8 u | 110 deg arc | 4 | 60 | 57 / 44 | 155 / 120 |
| Duelist | Sword | 16 | 0.50 | 10 stamina | 2.4 u | 100 deg arc | 2 | 12 | 19 / 39 | 50 / 104 |
| Duelist | Katana | 13 | 0.40 | 8 stamina | 2.6 u | 80 deg arc | 1 | 9 | 15 / 40 | 41 / 106 |
| Mage | Staff (Ember Bolt) | 26 | 0.90 | 12 magic | 22 u at 14 u/s | Splash 1.5 u | 3 | 15 | 33 / 37 | 91 / 101 |
| Mage | Wand (Ash Dart) | 14 | 0.50 | 7 magic | 24 u at 20 u/s | Single | 1 | 6 | 18 / 36 | 49 / 97 |
| Ranger | Longbow | 20 | 0.70 | 9 stamina | 30 u at 28 u/s | Single | 1 | 8 | 24 / 37 | 65 / 98 |
| Ranger | Crossbow | 30 | 1.05 | 16 stamina | 26 u at 34 u/s | Pierces 2 | 2 | 14 | 36 / 37 | 97 / 98 |

Reasoning behind the shape of this table:

- Melee does 39 to 44 DPS and ranged 36 to 37. Melee takes more risk, and the Juggernaut also hits groups.
- Hits land at 55% of attack time for Juggernaut, 40% for Duelist, 45% for Ranger and 50% for Mage.
- Movement while attacking is x0.2 for melee (the existing value), x0.4 for Mage and x0.55 for Ranger.
- Stamina lasts about 8 s of nonstop swings for Juggernaut, 5 s for Duelist, and 8 to 11 s for Ranger. Magic lasts about 17 s for Mage.

**Melee hit test:** distance to target <= reach + target radius + 0.5 u, and inside the arc. The 0.5 u is the tolerance for network delay.

**Starting weapons.** These are the setups in `client/src/game/characters.ts` today. Each maps to a family, and the only mechanical difference is that a shield setup blocks better.

| Class | Setup 0 | Setup 1 | Setup 2 |
|---|---|---|---|
| Juggernaut | War hammer: Hammer | Double axe: Axe | Mace and shield: Hammer |
| Duelist | Katana: Katana | Longsword: Sword | Zweihander: Sword |
| Mage | Magic staff: Staff | Wand and tome: Wand | Quarterstaff: Staff |
| Ranger | Longbow: Longbow | Shortbow: open | Spear: open |

Every class has exactly 3 setups, which matches `APPEARANCE_LIMITS.variant` in `shared/classes.ts`. The weapon-to-family mapping is not in code yet, since combat is not built. Mace as Hammer and Quarterstaff as Staff are proposals.

**Open decision: Ranger.** The Ranger families above are Longbow and Crossbow, but the game now offers a longbow, a shortbow and a spear. `weapons.glb` has no crossbow, the only crossbows on disk are the cartoony KayKit ones in `game-assets/`, and the spear is melee while the Ranger's numbers are ranged. Decide before per-class attack numbers go in (M2): does the Shortbow replace the Crossbow row with new numbers, does a crossbow come back, and does the Spear stay? The Crossbow row stays as written until then.

Equipping a looted weapon of the same family keeps your look. A different family switches to that family's default setup.

### 1.4 Weapon tiers

There are 8 families and 5 tiers, so 40 weapons in total and 10 for any one class. IDs look like `hammer_gilded`. The table lives in `shared/combat.ts`, not the database.

| Tier | Damage mult | Scale per stat point above 10 | Look | Where it comes from |
|---|---|---|---|---|
| Rusted | 1.00 | 3.0% | Brown, desaturated | Your starting weapon. Never drops. |
| Iron | 1.25 | 3.5% | Neutral gray | Wolf 1%, Husk 1.5%, Minion 2%. Chests C1 and C2. |
| Tempered | 1.55 | 4.0% | Cold blue-gray | Rogue 3%, Skeleton Mage 3%, Warrior 3%. Chest C3. |
| Gilded | 1.90 | 4.5% | Gold | Warrior 1%, Revenant 12%. Chest C4. Guaranteed on your first boss kill. |
| Sovereign | 2.40 | 5.0% | Black with ember glow and red digit motes | Boss only: 15% per kill, guaranteed on your 5th kill if you have none. |

Example: a Juggernaut with Strength 18 and a Rusted axe hits for 50. After 10 upgrades into Strength (561 dust) and an Iron axe it hits for 40 x 1.25 x (1 + 18 x 0.035) = 82.

Rolls always produce a weapon for the looter's class. The family is random between that class's two.

**Duplicates.** Each account holds one copy of each weapon ID. A duplicate turns into dust on pickup: Iron 20, Tempered 60, Gilded 150, Sovereign 400. So inventory never exceeds 10 items and needs no management screen beyond a list.

There are no stat requirements to wield a weapon. A student who finds a Gilded sword during User Tests should get to use it.

### 1.5 Binary Dust

Rolled separately for each player who earned the kill (section 1.6).

| Enemy | Dust chance | Dust amount | Potion chance |
|---|---|---|---|
| Deer | 80% | 2 to 3 | 0% |
| Wolf | 90% | 4 to 6 | 3% |
| Husk (zombie) | 90% | 5 to 8 | 4% |
| Skeleton Minion | 90% | 6 to 9 | 3% |
| Skeleton Rogue | 100% | 9 to 13 | 4% |
| Skeleton Mage | 100% | 10 to 14 | 5% |
| Skeleton Warrior | 100% | 14 to 20 | 5% |
| Citadel Revenant | 100% | 35 to 50 | 10% |
| Ashen Sovereign | 100% | 300 | Restocks you to 5 |

Dust is +25% at night.

**Raising a stat.** Any stat can be raised at a bonfire by 1 point. Cost depends on your level, not on which stat, and level = 1 + total upgrades bought.

```
cost(level) = round(12 + 6 x (level - 1) + 0.6 x (level - 1)^2)
```

| From level | To level | Cost | Total dust spent |
|---|---|---|---|
| 1 | 2 | 12 | 12 |
| 2 | 3 | 19 | 31 |
| 3 | 4 | 26 | 57 |
| 5 | 6 | 46 | 138 |
| 8 | 9 | 83 | 348 |
| 10 | 11 | 115 | 561 |
| 15 | 16 | 214 | 1,419 |
| 20 | 21 | 343 | 2,862 |
| 30 | 31 | 691 | 8,103 |

Expected income, assuming a kill every 12 to 20 s: 25 dust per minute around the village, 45 in the graveyard, 75 in the citadel. So a first upgrade comes in about 30 s, five upgrades in about 5 minutes, and about level 20 in an hour. The audience will see upgrades during a short User Test, which is the goal.

Existing columns stay in use. `binary_dust` is unspent dust, `level` is the level above, and `xp` stores lifetime dust earned. The existing leaderboard sort (`level DESC, xp DESC`) then works unchanged.

### 1.6 Looting in multiplayer

**Loot is personal, so it cannot be stolen.**

1. An enemy keeps a list of players who hit it. Your entry counts if your last hit was within 20 s. Resetting an enemy clears the list.
2. On death, every player on the list gets their own full roll for dust, potion and weapon. Nothing is split, so helping a stranger costs you nothing.
3. Everyone nearby sees the same red dust burst. Dust amounts and drops go only to the player who earned them, in a private message.
4. A weapon drop appears as a gold beam only on that player's screen. Press E within 3 u. The server checks owner and distance.
5. Drops last 120 s. If a player disconnects or the drop expires, the weapon goes to their inventory anyway, so nobody loses a Sovereign weapon to bad Wi-Fi.
6. Dust is credited automatically and the particles fly to you. Potions are picked up automatically within 2 u.

**Boss eligibility:** at least 5 hits, or at least 1 revive, during that fight.

**Chests:** one per account. Opening one sets a flag on your account, and other players still see it closed.

### 1.7 Downed, death and respawn

1. At 0 health you go **downed** for 15 s. You crawl at 0.6 u/s and cannot act. Enemies ignore you.
2. Any other player within 2.5 u holds E for 2.5 s to revive you at 35% health. A hit interrupts the channel. Both players see a filling gold ring. This is the main Objective 3 interaction.
3. If no other player is within 40 u, the downed timer is 3 s instead, so solo players do not wait.
4. When the timer ends you die. Half of your unspent dust (rounded down) drops as a **Bit Stain** where you fell. Only you can see it, and walking within 2 u reclaims it. A new death replaces the old stain, and those dust are gone.
5. You respawn at your last bonfire after 5 s, at full health, with potions restocked to at least 3.

You never lose weapons, levels or spent dust. Enemies do not reset. `player_stats.deaths` increases by 1.

### 1.8 Healing potions

| Rule | Value |
|---|---|
| Heal | 40% of max health at the end of a 1.0 s drink |
| While drinking | Move at x0.4. Getting hit does not cancel it. Cannot start during attack or dodge. |
| Carry limit | 5 |
| Start and restock | 3. Bonfires restock to 3 and never reduce a higher count. |
| Extra potions | Enemy drops, up to 5 |
| Controls | Q, `Consume` clip |

### 1.9 Bonfires

There are five (section 2). Press E within 3 u to rest. Resting takes 1.5 s and uses the `Interact` clip, since the kept clips have no sit animation, and it does the following:

- Heals fully and restocks potions to 3.
- Sets your respawn point and lights this bonfire for your account.
- Opens the gold menu: **Upgrade** (six stats with cost and effect preview), **Weapons** (equip) and **Travel** (any bonfire you have lit).

The shared world does not pause, and enemies do not reset. This is different from single-player games because one player resting must not respawn other people's fights. Enemies cannot enter a 10 u circle around a bonfire. Stat changes and travel are only accepted within 3 u of a bonfire, and the server checks that.

### 1.10 Controls, block and specials

| Input | Action |
|---|---|
| WASD, mouse, Shift, Space, left click | Already built: move, look, run, dodge, attack |
| Right click (hold) | Block |
| Q | Potion |
| E | Interact: loot, chest, bonfire. Hold to revive. |
| F | Class special |
| M | Map showing every online player |

**Block (P1).** Front 120 degrees only. Reduces damage 60% for Juggernaut and Duelist, 75% with a shield setup, 40% for Mage and Ranger. Stamina lost = damage absorbed x 0.5, and running out breaks your guard for a 0.8 s stagger. Move at x0.5. Ashen Charge cannot be blocked. If block is cut, also remove its row from `Hud.tsx`.

**Specials (P1).** These give non-casters a reason to have a magic bar.

| Class | Special | Magic | Cooldown | Effect |
|---|---|---|---|---|
| Juggernaut | War Cry | 30 | 12 s | Enemies within 10 u target you for 4 s. Allies within 10 u take 25% less damage for 5 s. |
| Duelist | Gale Step | 20 | 8 s | 6 u invulnerable dash, 150% weapon damage to everything in the path. |
| Mage | Mending Ward | 40 | 15 s | 5 u circle for 6 s. Allies inside heal 5% of max health per second. |
| Ranger | Marked Prey | 20 | 12 s | Target takes +15% from all players for 6 s. |

There is no player-versus-player damage and no free-text chat. No PvP avoids griefing, and no chat removes an HTML injection surface that would put all four objectives at risk.

### 1.11 Day and night

The cycle already runs for 20 minutes from the wall clock. Move `worldPhase` into `shared/` so the server can read it too. Night is phase 0.62 to 0.95, about 6.6 minutes: dust +25%, enemy damage +15%, and lit windows and lanterns come on. Clients may differ from the server clock by a few seconds, and the server's clock decides the rules.

---

## 2. World

The world is 480 u wide and 500 u deep: x from -240 to 240, z from -290 to 210. Walking the road from spawn to the arena is 373 u. Alternating run and walk averages about 4.4 u/s, so that takes **about 85 seconds without fighting**. This is on purpose, because User Tests are short and the audience should be able to reach the boss.

```
   z     x: -240            -60    0    60            240
-290  +--------------------------------------------------+
      |                   .----------.                   |
-240  |                   | THRONE   |  center (0,-240)  |
      |                   | OF ASH   |  radius 42        |
-198  |                   '----++----'                   |
-190  |          +---------causeway---------+            |
-170  |          |                     [C4] |            |
-145  |          |      FALLEN CITADEL      |            |
-108  |          |           [B5]           |            |
-100  |          +-----------gate-----------+            |
 -90  | +--------------+     |    |     +--------------+ |
 -50  | | [C3]         |     |    |     |         [C2] | |
  10  | |      [B4]    |   ASH FLATS    |   [B3]       | |
  30  | | SUNKEN       |  +--+----+--+  | CURSED       | |
  70  | | GRAVEYARD    |==| VILLAGE  |==| FOREST       | |
      | |              |  | [C1] [B2]|  |              | |
 110  | +--------------+  +----++----+  +--------------+ |
 115  |          .---- PALE MEADOW -----.                |
 155  |          '---------++-----------'                |
 175  |             PILGRIM'S REST [B1]                  |
 210  +--------------------------------------------------+
```

### Zones

Enemy counts are the base number at low population (see crowd scaling below). Total: 128.

| Zone | Area | Enemies | Fog near to far | Key props |
|---|---|---|---|---|
| **Pilgrim's Rest** (spawn) | Circle at (0, 175), radius 20. Safe. | None | 20 to 85 | Bonfire, ruined shrine, 4 banners, 8 pillars, candles, signpost with controls |
| **Pale Meadow** | x -90..90, z 115..155 | 8 Deer | 20 to 85 | Tall grass sprites, rocks, fence ruins |
| **Forsaken Village** | x -60..60, z 30..110. Gates at (0, 110), (0, 30) and (+/-60, 70). | 16 Husks in 4 groups, 6 Minions at the chapel | 18 to 80 | 14 houses, chapel at (-35, 45), well, 60 fence pieces, 30 barrels, 25 crates, 3 carts, 4 market stalls, 14 lantern posts, tables, mugs |
| **Ash Flats** | x -60..60, z -100..30. The road north. | 6 Minions on patrol | 18 to 80 | Dead trees, rubble, broken carts, skeleton piles |
| **Cursed Forest** | x 60..230, z -90..110. Clearing at (150, 10), radius 18. | 18 Wolves in 6 packs, 12 Deer in 3 herds near x < 110, 6 Husks at the hut | 10 to 55 | 220 trees with trunk colliders, 60 rocks, 800 undergrowth sprites, bones, 12 path lanterns, standing stones, hunter's hut at (190, -40) |
| **Sunken Graveyard** | x -230..-60, z -90..110. Visually 2.5 u below ground level. | 18 Minions that rise from the ground on approach, 8 Rogues, 6 Skeleton Mages | 12 to 65 | 60 graves, 40 gravestones, 30 markers, 12 coffins, 3 crypts, 4 shrines, 80 iron fence pieces, 2 gate arches, 10 lanterns, bones, shallow water |
| **Fallen Citadel** | x -90..90, z -190..-100. Main gate at (0, -100), breaches at (+/-90, -130). | 12 Warriors, 8 Skeleton Mages, 4 Revenants at the causeway | 20 to 85 | 90 wall pieces, 30 pillars, 16 banners, 40 rubble, 20 torches, 6 stairs, 4 towers |
| **Throne of Ash** | Circle at (0, -240), radius 42, reached by a causeway at x -6..6, z -198..-190. Fully flat so telegraphs lie true. | Ashen Sovereign | 30 to 85 | Tile floor, 12 broken pillars with no collision, 8 braziers, throne at (0, -272), 8 banners, fog gate at (0, -196) |

Bonfires:

| ID | Location | Position |
|---|---|---|
| B1 | Pilgrim's Rest (always lit) | (0, 175) |
| B2 | Village square | (6, 70) |
| B3 | Forest clearing | (150, 10) |
| B4 | Crypt steps | (-145, 10) |
| B5 | Citadel gate | (0, -108) |

Chests:

| ID | Location | Position | Guaranteed tier |
|---|---|---|---|
| C1 | Village chapel | (-35, 45) | Iron |
| C2 | Hunter's hut | (190, -40) | Iron |
| C3 | Graveyard crypt | (-190, -50) | Tempered |
| C4 | Citadel east tower | (72, -170) | Gilded |

From B5 to the arena is about 20 s, which keeps the boss retry loop short.

### Crowd scaling

`spawnScale = clamp(online / 15, 1, 2.5)`. Group size is multiplied by it and the respawn time (base 45 s) is divided by it. This allows a maximum of 320 enemies alive, and a hall of 200 still has things to fight. Spawn points are scattered within 12 u of B1, and players do not collide with each other, so a crowd arriving at once is harmless.

### How the map is built

- A script (`scripts/build-map.ts`) takes hand-placed points plus seeded scatter rules per zone. It writes one generated file, `shared/mapData.ts`, committed to the repo: colliders, spawn points, bonfires, chests, prop instances and a height grid. Both server and client import it.
- The map is generated once at build time, not at load time. `Math.sin` and `Math.cos` may differ slightly between browsers, so generating colliders at runtime could give different collision between players.
- It is a `.ts` file rather than JSON so it works with the existing Docker build without any config changes.
- Height is **visual only**, from a 5 u grid. The simulation stays 2D, there is no jumping, and hit tests ignore height. Combat areas are kept nearly flat.
- Keep fog far below the interest radius (section 4.4) so nobody sees players appear from nothing.
- Props render with one `InstancedMesh` per prop type, and types are only drawn for zones within 120 u.

---

## 3. Enemies and boss

### Shared enemy behavior

```
SLEEP   no player within 48 u. Checked at 2 Hz, no other cost.
  -> IDLE      a player came within 48 u. Wanders within 6 u of home.
IDLE
  -> ALERT     a player is inside aggro radius with a clear line, or hit it
ALERT   0.4 s, faces target, plays alert sound
  -> CHASE
CHASE   moves toward target
  -> WINDUP    in attack range and holds an attack token
  -> RETURN    more than leash distance from home, or target died or left
WINDUP  telegraph. Facing locks for the last 0.25 s.
  -> STRIKE
STRIKE  one hit check, one tick
  -> RECOVER
RECOVER can be punished, no turning
  -> CHASE
STAGGERED  0.8 s, entered from any state when poise breaks
  -> CHASE
RETURN  walks home, ignores players, heals 20% per second, clears the hit list
  -> IDLE
DEAD    corpse for 4 s, then removed. Respawn is scheduled by its camp.
```

Rules that keep this cheap and fair:

- **Poise:** weapon stagger power adds up. Breaking it staggers the enemy, and it resets after 3 s without a hit.
- **Attack tokens:** at most 3 enemies can be in WINDUP against one player at a time, and the rest circle at 4 u. A crowd of skeletons cannot kill a new player instantly.
- **Pathing:** no navmesh. Enemies steer straight at the target and slide along colliders. If they make under 0.5 u of progress in 1 s, they try a +/-45 degree heading for 1 s, and after 3 failures they RETURN.
- **Separation:** enemies push apart softly, up to 4 neighbors.
- Enemies never block players. Blocking would make prediction wrong, since the client only predicts against the static map.
- Downed players are not targets.

### Enemy table

Time to kill assumes about 38 DPS at creation with a Rusted weapon. Enemy damage is +15% at night.

| Enemy | Model | HP | Armor | Damage | Windup (s) | Recovery (s) | Speed (u/s) | Aggro (u) | Leash (u) | Poise | Time to kill | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Deer | Quaternius Deer | 40 | 0 | 0 | | | 6.5 | | | 1 | 1 s | GRAZE, then FLEE for 4 s when hit or a player is within 8 u. The herd flees together. |
| Wolf | Quaternius Wolf | 85 | 0 | 12 | 0.45 | 0.7 | 5.5 | 18 | 40 | 20 | 2 s | Packs circle at 4 u. One token per pack at a time, 1.2 s apart. |
| Husk | Human kit with `Zombie_*` clips (preferred), or Quaternius Zombie. Open, section 5.5. | 150 | 0 | 16 | 0.80 | 1.0 | 2.2 | 12 | 25 | 35 | 4 s | Slow and easy to read. Teaches dodging. |
| Minion | KayKit Skeleton_Minion | 110 | 10% | 14 | 0.60 | 0.8 | 2.8 | 14 | 28 | 25 | 3 s | Rises with `Skeletons_Awaken_Floor` in the graveyard. |
| Rogue | KayKit Skeleton_Rogue | 130 | 5% | 18 | 0.50 | 0.9 | 4.2 | 16 | 30 | 25 | 4 s | Sidesteps at range, lunges 4 u. |
| Skeleton Mage | KayKit Skeleton_Mage | 120 | 0 | 20 ranged | 1.40 | 1.0 | 2.4 | 20 | 30 | 20 | 3 s | Keeps 8 to 16 u away. Fires a dodgeable bolt at 12 u/s, range 18 u. |
| Warrior | KayKit Skeleton_Warrior | 260 | 20% | 26 | 0.90 | 1.1 | 2.8 | 16 | 30 | 60 | 9 s | Blocks every 3rd hit from the front. |
| Revenant (elite) | Skeleton_Warrior at x1.35 of normal enemy size (about 2.4 u tall), dark gold | 620 | 30% | 40 | 1.10 | 1.3 | 3.0 | 18 | 35 | 120 | 23 s | Adds a 5 u spin attack (`2H_Melee_Attack_Spinning`) when 3+ players are close. |

Clip names for the four skeletons were read from the files (`game-assets/README.md`). The Wolf and Deer models and the Poly Pizza zombie have not been downloaded yet, so their clips are unknown (section 5). A Husk on the human kit would use `Zombie_Idle_Loop`, `Zombie_Walk_Fwd_Loop` and `Zombie_Scratch`, which are already in the game files.

**Open art decision.** The KayKit skeletons are cartoony and clash with the new human players, so the Zombie and other human-proportioned options should be preferred (section 5.5). The table keeps the KayKit names until that is decided. A KayKit skeleton is 2.17 u tall in its file, so a normal enemy needs about x0.8 to stand level with a 1.75 u player.

### Ashen Sovereign

| Property | Value |
|---|---|
| Model | KayKit `Skeleton_Warrior` at about 5.25 u tall, which is 3 times a player and about x2.4 of the file's 2.17 u. Ash tint, ember eyes, code-made gold crown, PSX zweihander (node `zweinhander` in `weapons.glb`). Clips are confirmed in the file. Every clip named below belongs to that file, so they change if the body changes. Section 5.5 covers swapping in a better body. |
| Health | 4,000 + 5,000 x N, where N = players who hit the boss or stood in the arena in the last 30 s, rechecked every 5 s. When N changes, current health keeps the same percentage. |
| Fight length | Before armor: about 225 s solo and 160 s for 3 players at 40 DPS each, and about 250 s for 100 new players at 20 effective DPS each. |
| Armor | 15%. Takes +25% during Charge recovery. Immune to stagger. |
| Speed | 3.0 u/s, 4.2 u/s in phase 2. Does not block players. Never leaves the arena. |
| Target | Highest threat, where threat = damage over the last 10 s. Every 12 s it switches to a random player within 25 u, so large fights spread attention. War Cry overrides this for 4 s. |
| Kill reward | 300 dust, Gilded on first kill, 15% Sovereign. `boss_slayer` for everyone eligible, `unbroken` for anyone who was not downed in the fight. |
| Respawn | 5 minutes. `BOSS_RESPAWN_SECONDS` can shorten this during the presentation. |

**States:**

```
DORMANT   no players in the arena. Stands on the throne.
  -> AWAKEN        first player passes the fog gate
AWAKEN    3 s, Skeletons_Awaken_Standing, name and health bar appear. Invulnerable.
  -> CHASE
CHASE     walks to target, at least 0.6 s between attacks
  -> TELEGRAPH     picks an attack (table below)
TELEGRAPH -> ACTIVE -> RECOVER -> CHASE
PHASE_SHIFT  at 50% health, after the current attack ends
  -> CHASE
DEAD      Death_C_Skeletons, 400 dust particles over 6 s. Players have no cheer clip (section 5.1)
  -> respawn timer -> DORMANT
RESET     arena empty for 30 s: heals to full -> DORMANT
```

**Attack choice:** within 9 u, 70% Cleave and 30% Rupture. From 9 to 25 u, 60% Rupture and 40% Charge. Beyond 25 u, always Charge. It never uses the same attack 3 times in a row.

**Attack timings.** Phase 2 runs at x0.75 time, so every attack is one third faster.

| Attack | Telegraph (what you see) | Telegraph time P1 / P2 | Active | Recovery P1 / P2 | Damage | Clip |
|---|---|---|---|---|---|---|
| **Cleave** | Sword raised, red 150 degree cone of radius 9 u fills on the ground | 1,100 / 825 ms | One check at 200 ms | 1,200 / 900 ms | 65 | `2H_Melee_Attack_Slice` |
| **Ground Rupture** | Sword planted, a crack line runs to each target. 7 circles of radius 2.5 u, spaced 4 u, along each line. | 1,600 / 1,200 ms | Circles erupt in order, one per 120 / 90 ms | 1,400 / 1,050 ms | 50 per circle hit, at most once per cast | `Spellcast_Summon` |
| **Ashen Charge** | `Taunt`, then a red lane 5 u wide and 28 u long. Aim locks 300 ms before it moves. | 1,000 / 750 ms | Dash at 22 / 26 u/s, about 1.27 / 1.08 s | 1,800 / 1,350 ms, takes +25% damage | 80, plus 5 u knockback. Unblockable. | `Running_C`, then `2H_Melee_Attack_Stab` |

- Rupture lines: 1 + N / 6, at most 10, so large crowds get more of them.
- Phase 2 addition: after a Cleave, 50% chance of a second Cleave with a 500 ms telegraph.
- **Phase shift at 50%:** 2.5 s `Taunt_Longer`, invulnerable. A shockwave within 12 u does 20 damage and pushes players back 6 u. The arena lights turn red and the music changes.
- **Reaction check:** a telegraph reaches a player one network delay after it starts, and their dodge takes one more delay to arrive. At 200 ms round trip, a normal phase 2 Cleave still leaves 625 ms. The follow-up Cleave leaves 300 ms, which is meant to be hard.

Cleave does 65, so a Mage (108 health) survives one and a Juggernaut (156) survives two. Dodge timing and revives matter from the first fight.

---

## 4. Technical design

### 4.1 Code layout

```
shared/
  sim.ts          add: collision, magic, stagger, knockback, block, drink
  protocol.ts     add: binary layout and new messages
  combat.ts       new: weapons, tiers, damage, level cost (pure functions)
  enemies.ts      new: enemy stats and drop tables
  collision.ts    new: grid lookup and push-out
  mapData.ts      generated, committed
server/src/app/
  realtime.ts     keeps sockets, auth, tick timer
  world/          players, combat, enemies, boss, loot, interest, snapshot, persist
server/loadtest/  bots.ts, storm.ts
server/migrations/002_game.sql
client/src/game/
  GameClient.ts   thinner
  input.ts, touch.ts, entities.ts, mapView.ts, dustFx.ts, telegraphs.ts
scripts/
  build-map.ts, assets/
tools/
  build-models.mjs   exists: rebuilds the player kits, clips and weapons
```

`shared/protocol.ts`, `shared/sim.ts` and `GameClient.ts` are where teammates would collide. Tabshir owns the first two and merges others' changes. Split `GameClient.ts` into the modules above during M0 so each person edits their own files.

### 4.2 Server tick order

Runs at 30 Hz. Replace the `setInterval` with an accumulator on `performance.now()`, catching up at most 3 ticks.

1. Apply queued inputs through `stepPlayer`, with the existing input budget.
2. Fire attacks that reached their hit moment: arc test for melee, spawn a projectile for ranged.
3. Move projectiles. They stop at static colliders.
4. Run enemy AI: decisions at 10 Hz (one third of enemies per tick, by `id % 3`), movement each tick.
5. Run the boss.
6. Apply damage, deaths, dust and loot, and collect events.
7. Every 2nd tick, send snapshots.
8. Every 10 s, flush changes to Postgres without waiting.

Log tick time p50 and p99 every 10 s. The load test reads them.

### 4.3 Server-authoritative combat

- The client sends only intent: movement, facing and buttons. It never sends damage, health, dust, position of a hit, or who was hit.
- The client predicts only movement, stamina, magic and starting an animation. Health changes only when the server says so.
- Damage, stamina costs, loot, upgrades and distance checks are all server-side. Stats come from the database, and identity comes from the verified JWT.
- `stepPlayer` stays shared. `Derived` gains `attackSeconds`, `attackCost`, `attackMoveMultiplier` and the rest, so prediction uses the same class numbers as the server. `ATTACK_SECONDS` in `shared/sim.ts`, which `characters.ts` also reads, becomes per-weapon.
- There is no rewinding for lag. Melee gets a 0.5 u reach tolerance, enemies are slow, and projectiles are simulated on the server only. The client shows its own arrow instantly and then blends to the server's.
- Knockback and stagger are in `SimState`, so reconciliation corrects them like any other movement.

### 4.4 Snapshots and interest management

**The problem.** Interest management is not built yet. Today one JSON list of every player goes to every client. An entry was estimated at about 55 bytes, sent 15 times per second. The Nov 5 load test measured 41 KB/s per client with 60 players at 14.8 snapshots per second, which works out to about 46 bytes per entry:

| Players | At 55 bytes per entry | At the measured 46 bytes |
|---|---|---|
| 100 | 66 Mbit/s | about 55 Mbit/s |
| 200 | 264 Mbit/s | about 220 Mbit/s |

It grows with the square of the player count, so this has to change before the hall joins.

**The design:**

- **Grid:** 40 u cells. Each client looks at 5 x 5 cells around itself.
- **Radius:** an entity enters at 90 u and leaves at 100 u, so entities near the edge do not flicker. Fog far never exceeds 85 u.
- **Priority:** the nearest 16 players go in every snapshot (15 Hz). Others in range go in one of every 4 snapshots (3.75 Hz), by `id % 4`, with at most 64 player entries per snapshot. The client's interpolation delay per entity grows to match, about 300 ms for the slower ones.
- **Enemies:** the nearest 40.
- **Self block:** your exact state goes only to you. `dodgeX`, `dodgeZ`, `regenDelay` and stamina leave the shared entries.

**"All users visible" still has to hold,** since the assignment asks for all users and their actions to be visible. So once per second every client gets a roster of every online player's coarse position (4 bytes each), drawn on the minimap and M map. It is built once and shared. This also lets a two-browser grader see the other user wherever they are.

**Binary format** for server-to-client snapshots. Client-to-server input stays JSON, since it is small and already works.

| Block | Size | Fields |
|---|---|---|
| Header | 9 B | type u8, ack seq u32, server time u32 |
| Self | 56 B | position, yaw, stamina, magic, health, timers, dodge and knockback direction, as f32 |
| Player entry | 10 B | id u16, x i16, z i16 (at 0.01 u), yaw u8, flags u8 (moving, dodging, attacking, blocking, downed, dead, drinking), attack count u8 (wraps at 256, today it wraps at 1024), health % u8 |
| Enemy entry | 9 B | id u16, x i16, z i16, yaw u8, state u8, health % u8 |
| Boss entry | 12 B | Same as enemy, plus phase, attack ID and telegraph time |
| Events | 7 B each | hit, death, dust burst, projectile, telegraph. Yours always, plus up to 8 others' per snapshot. |

**Result in the worst case,** 200 players all in the boss arena:

- About 62 player entries, 40 enemies, self, header and events: about 1.1 KB per snapshot.
- About 17 KB/s per client, about **27 Mbit/s** total at 200 players. That is about one tenth of today, for the case where everyone stands together.

**Protection for the server:**

- Skip a client's snapshot when `socket.bufferedAmount` is above 64 KB. The next one replaces it anyway. This part is still to do. Today `send` has only the last resort, which drops a client as soon as it goes above 1 MB, so one slow phone cannot grow server memory.
- Keep `permessage-deflate` off (the `ws` default).
- Hard cap of 300 players. Player 301 sees a gold "realm is full" screen with a queue position.
- If p99 tick exceeds 25 ms, shed in order: snapshots to 10 Hz, then player entries to 32, then spawn scale to 1, then inputs batched at 15 Hz.

### 4.5 Collision

Same code on both sides, so prediction agrees with the server.

- **Shapes:** circles (trees, rocks, graves, pillars) and rotated rectangles (houses, walls, fences). Rotation is baked into `mapData.ts` as a stored sine and cosine. About 500 colliders.
- **Lookup:** uniform 8 u grid with a flat array of collider indexes.
- **Resolve:** the player is a 0.45 u circle. After moving, push out of any overlap, up to 3 passes. This gives sliding along walls. The fastest step is about 0.3 u per tick and colliders are thicker than that, so nothing can be tunneled through.
- **Precision:** new code uses `Math.sqrt`, not `Math.hypot`, since `sqrt` gives the same answer in every browser. Existing small mismatches are already handled by reconciliation.
- **World edge:** the circle check at `WORLD_RADIUS` becomes a clamp to the rectangle in section 2, with cliffs as the visual.
- **Others:** enemies use the same function on the server. Players never collide with players or enemies.
- **Camera:** pull in when a collider is between the camera and the player. This is cheap with the same grid.
- **Version check:** `welcome` carries a `mapVersion`. A mismatch reloads the page, so a cached old client cannot disagree with the server.
- **Debug:** an F3 collider overlay in development builds only.

### 4.6 Database

`server/migrations/002_game.sql`:

```sql
ALTER TABLE player_profiles
  ADD COLUMN equipped_weapon VARCHAR(24),            -- NULL means the Rusted starter
  ADD COLUMN potions         SMALLINT NOT NULL DEFAULT 3,
  ADD COLUMN last_bonfire    VARCHAR(24) NOT NULL DEFAULT 'pilgrims_rest',
  ADD COLUMN stain_x         REAL,
  ADD COLUMN stain_z         REAL,
  ADD COLUMN stain_dust      INT NOT NULL DEFAULT 0;

ALTER TABLE player_stats
  ADD COLUMN undead_killed   INT NOT NULL DEFAULT 0; -- for the grave_walker achievement

CREATE TABLE player_weapons (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weapon_id   VARCHAR(24) NOT NULL,
  source      VARCHAR(24) NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, weapon_id)
);

-- Lit bonfires and opened chests: 'bonfire:village', 'chest:c1'.
CREATE TABLE player_world_flags (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag    VARCHAR(40) NOT NULL,
  set_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, flag)
);

CREATE TABLE boss_kills (
  id           BIGSERIAL PRIMARY KEY,
  killed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms  INT NOT NULL,
  player_count INT NOT NULL
);

CREATE TABLE boss_kill_players (
  kill_id BIGINT NOT NULL REFERENCES boss_kills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  damage  BIGINT NOT NULL,
  downs   INT NOT NULL,
  PRIMARY KEY (kill_id, user_id)
);
```

**Writes never block a tick.**

- A player has a dirty flag, and every 10 s one `UPDATE ... FROM unnest(...)` statement saves all changed players.
- Upgrades, weapon pickups, equips and boss kills save at once, without pausing the tick.
- Also save on disconnect. A crash loses at most 10 s of dust.
- Weapon definitions, enemy stats, positions, enemy state and boss health are not stored. Players reconnect at their last bonfire.

### 4.7 Messages to add

All client messages go through a strict shape check and the existing rate limit. All values are integers or IDs from fixed lists, with no free text.

**Client to server (JSON):**

| Message | Meaning | Server checks |
|---|---|---|
| `i` flags: 8 block, 16 potion, 32 interact held, 64 special | Extend existing input. The server drops any flags above `MAX_FLAGS` in `realtime.ts`, so add the new bits there too. | Stamina, cooldowns, potion count, revive distance |
| `{t:'upgrade', stat}` | Buy 1 point | Stat in `STAT_KEYS`, within 3 u of a bonfire, enough dust, below cap |
| `{t:'equip', weapon}` | Equip | Owned and matching class |
| `{t:'pickup', id}` | Take a drop | Drop owner and within 3 u |
| `{t:'open', chest}` | Open a chest | Within 3 u and not yet opened by this account |
| `{t:'rest'}` | Rest at a bonfire | Within 3 u, alive |
| `{t:'travel', bonfire}` | Fast travel | Lit, standing at a bonfire |

**Server to client:**

| Message | Format | Who gets it | Meaning |
|---|---|---|---|
| Snapshot | Binary | Each client | Replaces `s` |
| `welcome` | JSON | Joining client | Adds health, magic, potions, weapons, equipped, lit bonfires, stain, `mapVersion`, server time |
| `join`, `leave` | JSON | Everyone | Existing, and still global since they are rare |
| Roster | Binary, 1 Hz | Everyone | Coarse positions of all players |
| `{t:'self', dust, level, stats, potions}` | JSON | You | After any change |
| `{t:'pinfo', id, level, weapon}` | JSON | Nearby players | Another player changed look or level |
| `{t:'loot', id, weapon, x, z, ttl}` | JSON | Owner only | Weapon drop appeared |
| `{t:'loot_gone', id}` | JSON | Owner only | Picked up or expired |
| `{t:'boss', state, hp, phase, n}` | JSON, 2 Hz | Players near the citadel | Health bar |
| `{t:'feed', code, name}` | JSON | Everyone | Boss defeated, and similar. Fixed codes only. |
| `{t:'toast', code}` | JSON | You | "Not enough dust". Fixed codes, and the client holds the text. |
| `{t:'unlock', achievement}` | JSON | You | Achievement earned |

### 4.8 Binary Dust effect

**The look:** small red digits, each flipping between 1 and 0 at its own rate and jumping by a pixel, which matches the existing HUD icon (`client/src/components/BinaryDust.tsx`, 90 ms twitch).

**One `InstancedMesh` of quads with a custom shader, one draw call in total.** Nothing is written per frame on the CPU, so 4,000 particles cost about the same as 40.

| Part | Design |
|---|---|
| Glyphs | A 16 x 8 canvas texture made at startup, holding pixel-font `1` and `0`. Nearest filtering, no mipmaps. |
| Instance data | Origin (vec3), velocity (vec3), birth time, random seed, collector slot. 9 floats, 36 bytes, 144 KB for 4,000. |
| Allocation | A ring buffer. A burst writes only its own slots and uploads that range. If the buffer is full, the oldest particles get overwritten. Capacity 4,000 on desktop, 1,500 on phones. |
| Motion | Computed in the vertex shader from `uTime - birth`. 0 to 0.35 s: burst outward. 0.35 to 0.75 s: hang and rise. 0.75 to 1.35 s: curve toward the collector. Then it fades. |
| Collectors | `uniform vec3 uCollect[8]`, updated each frame. Slot 0 is you, and the rest are nearby players. Particles follow someone who is running without any CPU work per particle. |
| Twitch | `tick = floor(uTime * (8.0 + fract(seed * 7.0) * 6.0))` gives 8 to 14 flips per second. `digit = step(0.5, fract(sin(seed * 91.7 + tick) * 43758.5))` picks 1 or 0. The same tick adds a jump of 1 pixel. |
| Color | Chosen by seed from `#ff3b22`, `#d81e12`, `#8f120c`, with additive blend, alpha test, no depth write. Fog is off so it stays visible in dark zones. |
| Readability | At 240 to 300 lines, a distant digit would shrink to nothing. The vertex shader keeps each quad at least 7 internal pixels tall, so 1 and 0 stay readable. |
| Render order | Drawn in the low-res pass, so the dither shader applies and it matches the world. |

**Particle counts:** a kill emits `clamp(6 + amount x 2, 8, 48)`. The boss emits 400 over 6 s. A Bit Stain is a slow looping column of 24. Bursts are capped at 1,500 per second, and anything past that is simply not drawn.

**Sync:** the shared burst comes from a dust burst event in the snapshot, so everyone nearby sees the same thing. The HUD counter updates from the private `self` message.

### 4.9 Client performance

Target: **30 fps on a 2018 to 2020 Intel UHD 620 laptop with 40 players on screen.** At 240 to 300 lines of rendering, pixels are cheap, so the limit is draw calls and skinned characters.

| Budget | Limit |
|---|---|
| Draw calls | 250 |
| Triangles | 180,000 |
| Full skinned characters | Nearest 20 players and 20 enemies. 8 of each on phones. |
| Download before first playable frame | 5 MB compressed |
| Download in total | 20 MB compressed |

Player models already take most of the first-frame budget. One kit, both clip files and `weapons.glb` come to about 4 MB with the on-the-fly gzip nginx does today, and about 3.8 MB if precompressed at gzip level 6. `loadClips` in `characters.ts` loads both clip files before any character appears, so that is the first place to save.

Changes this requires:

- **`characters.ts` sets `frustumCulled = false` on every mesh,** so every character costs draw calls even when behind the camera. Cull per character with one bounding sphere on the root.
- **`dress` and `makeWeapon` in `characters.ts` create a new material per mesh per character.** Cache by texture and tint.
- **Crowd level of detail:** players past the nearest 20 render as one instanced baked idle pose per class, with a small bob in the shader and a tint per instance. In fog at distance this is hard to tell apart, and 200 players become about 4 draw calls.
- **Update animation mixers at 15 Hz** past 15 u. Stepped animation also suits the PS1 style.
- **Lazy loading:** load your own body's kit, the clips you need, `weapons.glb` and the spawn zone first. Everything else loads in the background, and a dark placeholder shows until it arrives. A kit is about 0.45 MB compressed and covers every class on that body, and a KayKit skeleton enemy is about 1.6 MB before pruning clips.

### 4.10 Security rules for new code

A violation of a labeled security concern can zero all four objectives, so:

- Queries stay parameterized. Dynamic text in the DOM uses `textContent`, as nameplates already do.
- Identity comes only from the JWT, never from a message.
- New WebSocket messages have fixed shapes and fixed IDs. Unknown messages are dropped.
- Add tests to `server/test/security.test.ts`: upgrade without enough dust, upgrade away from a bonfire, picking up another player's drop, equipping an unowned weapon, and oversized messages.
- `nginx` keeps its timeouts and body limits. The rate limits were raised on Nov 5 and these stayed, so keep it that way if they get raised again.

**Already fixed on Nov 5.** Keep these working when changing the code nearby:

- WebSocket upgrade path parsing cannot throw (`realtime.ts`).
- `Origin` is an exact match against the `ALLOWED_ORIGINS` list (`server/src/shared/http.ts`). `connect-src` no longer allows any `ws` or `wss` host, only the ones built from that list.
- nginx auth routes are case-insensitive (`nginx/snippets/routes.conf`).
- Inputs out of range are dropped, ping floods count toward the message limit, and slow clients are dropped (`realtime.ts`).
- sharp is upgraded to 0.35.5. Uploads are checked by their first bytes before decoding, with a 16 MP cap and one decode at a time (`server/src/app/avatars.ts`).
- Login attempts are counted before the slow password check, and per IP plus username (`server/src/auth/credentials.ts`).
- Downloads from outside services stop at the size limit as they stream (`server/src/app/avatarSources.ts`).
- `proxy_cookie_flags` marks every cookie `secure` in production (`nginx/prod.conf.template`).
- The JWT lifetime default is 12 hours (`JWT_TTL_SECONDS`).

---

## 5. Asset plan

Status as of Nov 5: **player characters, animations and weapons are finished and in the game**, in `client/public/models`, all CC0, rebuilt by `tools/build-models.mjs`. **4 KayKit packs are also on disk** in `game-assets/`, 310 models, all CC0, with clip names read from the files. They are still fine as environment and enemy sources, with the caveat in section 5.5. See `game-assets/README.md`.

**How downloads work:** itch.io free packs were downloaded through the normal page buttons in a browser. Poly Pizza refused scripted requests: both `poly.pizza` and `static.poly.pizza` answered with a Cloudflare bot challenge (HTTP 403). Those models must be hand-downloaded and their licenses have not been seen. Do not script around the challenge.

The player models and weapons have been seen in the game. Nothing else below has been visually judged yet. Clip names are confirmed only where marked. In the table, **Done** means it is already on disk, and **Hand** means someone must download it by hand.

### 5.1 Picks

| Need | Pick | License | Link | How to get it | Conversion |
|---|---|---|---|---|---|
| Player bodies, outfits, hair | Quaternius Universal Base Characters and Modular Character Outfits - Fantasy, free tier: Ranger and Peasant outfits, male and female bodies, hair | CC0 | [Base](https://quaternius.itch.io/universal-base-characters), [Outfits](https://quaternius.itch.io/modular-character-outfits-fantasy) | **Done**, `kit-male.glb` and `kit-female.glb` | `tools/build-models.mjs`. One 65-bone skeleton, about 1.75 u tall. |
| Player animations | Quaternius Universal Animation Library 1 and 2 | CC0 | [UAL 1](https://quaternius.itch.io/universal-animation-library), [UAL 2](https://quaternius.itch.io/universal-animation-library-2) | **Done**, `anim-1.glb` and `anim-2.glb`. 42 clips, read from the files. | Same script. Same skeleton as the kits. |
| Plate armor and robes, possible upgrade | Same outfit pack, $20 Source tier: full armored knight and wizard outfits | **Not verified** | [itch](https://quaternius.itch.io/modular-character-outfits-fantasy) | Not bought. Section 5.5. | Same script. |
| Hammer, katana, longsword, zweihander, axe, mace, dagger, spear, halberd, shield | PSX Weapon Pack by Amos | CC0 | [itch](https://amos-makes.itch.io/psx-weapon-pack) | **Done**, `weapons.glb` | Same script. Size and grip per weapon in a table in `characters.ts`, attached to `hand_r` and `hand_l`. Tier tint still to do. |
| Longbow, shortbow, arrow, magic staff, magic wand, spell tome, bo staff | LowPoly Fantasy Weapon Pack by CardinalZebra | CC0 | [itch](https://cardinalzebra.itch.io/low-poly-fantasy-weapon-pack) | **Done**, `weapons.glb`. The longbow is a real model now, not code-made. | FBX to GLB first, then the same script. Tier tint still to do. |
| Crossbow, only if the Ranger keeps one | KayKit Adventures or KayKit Skeletons weapons | CC0 | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | **Done**, in `game-assets/`, not in the game. Cartoony. | Open decision, section 1.3. |
| Skeleton enemies | KayKit Skeletons 1.0 | CC0 | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | **Done.** 95 clips confirmed. **Cartoony, so an open decision, section 5.5.** | Split into 4 bodies plus one shared clip file with about 14 clips. Clip data is about 2 MB per file today. The file is 2.17 u tall, so scale by about x0.8 to match a 1.75 u player. |
| Boss | KayKit `Skeleton_Warrior` at about 5.25 u (x2.4 of the file) | CC0 | Same | **Done.** Same cartoony clash, section 5.5. | Ash tint, crown, zweihander. |
| Boss, possible upgrade | Quaternius Demon | Listed CC0, unverified | [Poly Pizza](https://poly.pizza/m/LnfIziKv4o) | **Hand** | Check clips. Use only if it has idle, walk, 3 attacks and death, and looks better. Decide Nov 14. |
| Wolf, Deer | Quaternius | Listed CC0, unverified | [Wolf](https://poly.pizza/m/P1gU3Qkr9r), [Deer](https://poly.pizza/m/T6Cs7tmMHJ) | **Hand** | Read clip names, map to states. |
| Husk, preferred | Human kit with `Zombie_Idle_Loop`, `Zombie_Walk_Fwd_Loop` and `Zombie_Scratch`, in a Peasant outfit with the gray-green skin tint | CC0 | | **Done**, already in `client/public/models`. Not tried in the game yet. | None |
| Husk, alternative | Quaternius Zombie | Listed CC0, unverified | [Poly Pizza](https://poly.pizza/m/JoBvxIUpZP) | **Hand** | Same as Wolf and Deer. The last resort is a Skeleton Minion with a gray-green tint, which keeps the cartoony look. |
| Village buildings | Retro Medieval Kit | CC0 | [itch](https://kenney-assets.itch.io/retro-medieval-kit) | **Hand** | glTF. **Nothing on disk covers this**, so it blocks the village. |
| Props: barrels, crates, tables, chests, torches, banners, walls, pillars, rubble | KayKit Dungeon Remastered | CC0 | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0) | **Done** | Prune to what is used. Chest lids need code to open. Scale against a 1.75 u player (section 5.4). |
| Graveyard and trees: graves, coffins, crypts, shrines, fences, lanterns, bones, 10 trees | KayKit Halloween Bits | CC0 | [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0) | **Done** | glTF to GLB. Same artist as the KayKit skeletons, so these are the forest's trees too. **Do not use the pumpkins**, which read as comedy. |
| Extra graveyard pieces | Kenney Graveyard Kit | CC0 | [Kenney](https://kenney.nl/assets/graveyard-kit) | **Hand** | Regrade colors. |
| Citadel outer walls, towers | Kenney Castle Kit | CC0 | [Kenney](https://kenney.nl/assets/castle-kit) | **Hand** | Regrade colors. |
| Ground textures | Kenney Retro Textures Fantasy | CC0 | [Kenney](https://kenney.nl/assets/retro-textures-fantasy) | **Hand** | Downsample to 128 px, darken. |
| Extra surfaces | Tiny Texture Pack | CC0 | [itch](https://screamingbrainstudios.itch.io/tiny-texture-pack) | **Hand** | Same |
| Undergrowth, grass | Code-drawn cross-quad sprites | Ours | | Written in code, no download | Reuse the ground texture approach in `world.ts`. |

**Player clips.** The kept list is `KEEP` in `tools/build-models.mjs`. All 42 clips are in `anim-1.glb` and `anim-2.glb`.

| Use | Clips | Status |
|---|---|---|
| Idle | `Idle_Loop`, `Idle_Shield_Loop`, `Spell_Simple_Idle_Loop` | In use |
| Move and dodge | `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Roll` | In use |
| Attack | `Sword_Attack`, `TreeChopping_Loop`, `Sword_Regular_A`, `Sword_Regular_B`, `Sword_Regular_C`, `Spell_Simple_Shoot`, `Pistol_Shoot` | In use |
| Potion | `Consume` | Planned |
| Looting | `Chest_Open`, `PickUp_Table` | Planned |
| Bonfire and revive | `Interact` | Planned. There is no sit clip. |
| Block | `Sword_Block`, `Shield_OneShot` | Planned |
| Getting hit | `Hit_Chest`, `Hit_Head`, `Hit_Knockback` | Planned |
| Downed and death | `Death01` | Planned. There is no lie-down or crawl clip, so the crawl in section 1.7 needs a stand-in. |
| Undead enemies on the human kit | `Zombie_Idle_Loop`, `Zombie_Walk_Fwd_Loop`, `Zombie_Scratch` | Option, section 5.5 |
| Kept for later, no use chosen | `Sword_Idle`, `Sword_Heavy_Combo`, `Sword_Dash`, `Shield_Dash`, `Spell_Simple_Enter`, `Spell_Simple_Exit`, `Pistol_Idle_Loop`, `Pistol_Aim_Neutral`, `Pistol_Reload`, `Punch_Jab`, `Melee_Hook`, `OverhandThrow`, `Jump_Start`, `Jump_Loop`, `Jump_Land` | Not used |

Nobody has checked whether the source libraries also have sit, lie-down, crawl or cheer clips. If they do, adding one to `KEEP` and rerunning the script is enough, since they share the skeleton.

Considered and **not picked**:

- Skeleton Lord: CC-BY, login needed, idle and walk only, so a boss cannot attack with it.
- Skeleton Character PSX: CC-BY, login needed. It was dropped because the KayKit set already has full clips, so look at it again if the KayKit skeletons go (section 5.5).
- Poly Pizza Skeleton: dropped because KayKit covers it. The same note applies, and its license and proportions have not been seen.
- Boar: unanimated CC-BY 3.0, and no free animated boar was found. **Wolves and deer are the wildlife.**
- KayKit Adventurers 1.0: the player character until the user rejected it as cartoony.
- KayKit Adventurers 2.0: only useful for its bow, which the longbow model now covers, and the free tier's contents are inferred.

### 5.2 Please download these by hand

Save into the folder shown under `game-assets/`. On itch, "Name your own price" pages let you enter $0 and choose "No thanks, just take me to the downloads". **On each page, confirm the license says what is listed before saving.** If it does not, tell the team and skip it.

**Already downloaded and in the game, nothing to do:** Universal Base Characters, Modular Character Outfits - Fantasy (free tier), Universal Animation Library 1 and 2, PSX Weapon Pack and LowPoly Fantasy Weapon Pack. Their raw packs are not in `game-assets/`. `tools/build-models.mjs` takes a folder holding them as an argument.

**Required. Please finish by Sun Nov 8.**

- [ ] Wolf, https://poly.pizza/m/P1gU3Qkr9r, save GLB to `quaternius-wolf/`, confirm CC0
- [ ] Deer, https://poly.pizza/m/T6Cs7tmMHJ, save GLB to `quaternius-deer/`, confirm CC0
- [ ] Zombie, https://poly.pizza/m/JoBvxIUpZP, save GLB to `quaternius-zombie/`, confirm CC0. Compare it with a Husk on the human kit (section 5.5).
- [ ] Retro Medieval Kit, https://kenney-assets.itch.io/retro-medieval-kit, glTF, to `kenney-retro-medieval/`
- [ ] Kenney Retro Textures Fantasy, https://kenney.nl/assets/retro-textures-fantasy, to `kenney-retro-textures/`
- [ ] Kenney Castle Kit, https://kenney.nl/assets/castle-kit, to `kenney-castle/`

**Recommended. By Nov 12.**

- [ ] Demon (boss candidate), https://poly.pizza/m/LnfIziKv4o, save GLB to `quaternius-demon/`, confirm CC0
- [ ] Skeleton (enemy candidate), https://poly.pizza/m/DM4QScSmbS, save GLB to `quaternius-skeleton/`, confirm CC0. Check how it looks next to the human players.
- [ ] Fullplate Armor Knight (boss candidate, PSX style, CC0), https://magicalgothgirrl.itch.io/fullplate-armor-knight, to `fullplate-knight/`. Check whether it has any clips.
- [ ] Kenney Graveyard Kit, https://kenney.nl/assets/graveyard-kit, to `kenney-graveyard/`
- [ ] Tiny Texture Pack, https://screamingbrainstudios.itch.io/tiny-texture-pack, to `tiny-textures/`

**Optional, only if the world looks thin on Nov 20.**

- [ ] Low Poly Dead Trees (CC BY 4.0, FBX), https://godgoldfear.itch.io/low-poly-dead-trees. Requires credit.
- [ ] PSX+ Forest (CC BY, FBX), https://ju5t1nj.itch.io/psx-plus-forest-pack. Requires credit.
- [ ] Ultimate Modular Ruins (CC0, needs GLB conversion), https://quaternius.com/packs/ultimatemodularruins.html, files at https://drive.google.com/drive/folders/1ETp2ldaHaP0BkS4FBmkT-g9Yf88T_cIX
- [ ] 3D Retro Medieval Kit (CC0), https://chilly-durango.itch.io/medieval-building-parts
- [ ] ambientCG surfaces (redistribution allowed, downsample to 128 px), https://docs.ambientcg.com/license/

Direct file links for the Poly Pizza models are in `game-assets/README.md`. After downloading, read the clip names from each GLB and add a row to `game-assets/README.md`, the same way the KayKit packs are documented.

### 5.3 License flags

The course requires a **public repo**, so committing a raw asset file means redistributing it. That rules out packs that are otherwise free to use in a game.

| Do not use | Reason |
|---|---|
| Quaternius Bestiary | New QAL license bars standalone redistribution. |
| https://little-martian.itch.io/retro-texture-pack | Raw redistribution barred or restricted |
| https://ciprient.itch.io/psx-essential-textures | Raw redistribution barred or restricted |
| https://jamzuz.itch.io/fantasy-weapons-psx-inspired | Raw redistribution barred or restricted |
| https://seawheat.itch.io/psx-style-medieval-weapons-asset-pack | CC BY-ND, so no edits. Recoloring into tiers is an edit. |
| Fan recreations of existing games on Sketchfab | CC-BY from the uploader does not clear the original game's rights. Never use them. |
| Mixamo, Synty and asset store content | Raw redistribution forbidden |
| Poly Haven by script | Terms bar scraping. Single files by hand are fine. |

Paid and repo-safe, if the team ever decides to spend money: [PSX Medieval Pack](https://wildenza.itch.io/psx-medieval-pack), [PSX Graveyard Pack](https://crimsongcat.itch.io/psx-graveyard-pack), [PSX Dungeon](https://goblinatron.itch.io/psx-dungeon). Avoid [PSX Dungeon Animated Knight](https://mcsteeg.itch.io/psx-dungeon-animated-knight), whose terms conflict. The plan does not need any of them.

**Paid, license not verified:** the $20 Source tier of [Modular Character Outfits - Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) has the full armored knight and wizard outfits. The free tier is CC0, but nobody has verified the license of the paid tier. Read it before paying, since a public repo redistributes whatever is committed (see the Quaternius Bestiary row above).

**Credit:** list every pack on the `/credits` page and in the README, CC0 included, and add it to `client/public/models/LICENSES.txt` beside the models, as the Quaternius, Amos and CardinalZebra packs are now. CC BY packs are not usable without this.

**Repo:** `game-assets/` is already in `.dockerignore`, but not in `.gitignore`. Add `game-assets/*` with `!game-assets/README.md`. Only optimized files in `client/public/models` get committed, and the raw folders are kept by the team locally. This keeps the repo small and keeps license questions to what actually ships.

### 5.4 Conversion and style pipeline

Player kits, clips and weapons already go through `tools/build-models.mjs`. It needs the raw packs, which stay out of the repo, and the `npm i` line at the top of that file. Everything else still needs a script (`scripts/assets/`) that follows the same steps, so the result is the same for all:

1. **FBX only:** Blender headless to GLB.
2. **Clean up:** `@gltf-transform` with `prune`, `dedup`, `weld`, `resample`, textures resized to 128 px and `quantize`. The kits keep 256 px textures, and `tools/build-models.mjs` stores textures as WebP.
3. **No Draco and no Meshopt.** The site's CSP (`server/src/shared/http.ts`) has `script-src 'self'` and no `wasm-unsafe-eval`, and the same policy blocks the blob workers that Draco uses. Weakening the CSP for a small saving is the wrong trade. `KHR_mesh_quantization` is already used by the kit files and needs no decoder. `tools/build-models.mjs` uses Meshopt's simplifier at build time only, so its output needs no decoder either.
4. **Grade colors at build time,** using the recipe already in `gradeTexture` (`characters.ts`): pull toward gray, darken, warm. Every pack gets the same recipe, so they share a palette.
5. **Render everything the same:** `MeshLambertMaterial`, `applyVertexSnap`, nearest filtering, one fog.
6. **Compress for delivery:** the plan is for nginx to serve precompressed gzip. Today it gzips `.glb` files on the fly, at nginx's default level 1. That takes a kit from about 1 MB to about 0.45 MB, and the two clip files from about 8 MB to about 3.5 MB.
7. **Scale against the player.** Everything is sized next to a 1.75 u human. KayKit files do not match that as they come: a skeleton is 2.17 u, a large barrel 2 u and a wall 4 u. Set one scale per pack from a screenshot next to a player.

**Settled:** Three's `GLTFLoader` reads textures embedded in model files through blob URLs, so `connect-src` in the CSP now lists `blob:` (`server/src/shared/http.ts`).

### 5.5 Open art decisions

**None of these are decided. Settle them by Sun Nov 8 (M0), before enemies get built in M1.** The user rejected the KayKit players as cartoony. KayKit Skeletons, Dungeon and Halloween in `game-assets/` are still fine sources, but enemies made from them are cartoony and clash with the new human style, so the Zombie and other human-proportioned options should be preferred.

| Decision | Options | Notes |
|---|---|---|
| Husk | 1. Human kit with the `Zombie_*` clips. 2. Quaternius Zombie from Poly Pizza. 3. Tinted KayKit Minion. | Option 1 needs no download and no new skeleton, so try it first. |
| Minion, Rogue, Skeleton Mage, Warrior, Revenant | 1. Keep KayKit, with the color grade and scale in section 5.4. 2. Undead humans on the human kit, using the `Zombie_*` and `Sword_*` clips. 3. A human-proportioned skeleton from elsewhere: the Quaternius Skeleton on Poly Pizza or Skeleton Character PSX. | Option 1 is the only one with confirmed clips for these enemies today, and it keeps the clash. Option 2 changes what these enemies are, so their names and the clip notes in section 3 would change with it. Option 3 has not been seen, and Skeleton Character PSX is CC-BY and needs a login. |
| Ashen Sovereign | 1. KayKit `Skeleton_Warrior`. 2. Quaternius Demon. 3. Fullplate Armor Knight. 4. The human kit at boss size, in the paid plate outfit if the team buys it. | Pick in M1. The body needs idle, walk, 3 attacks and death. The human kit has `Sword_Heavy_Combo`, `Sword_Regular_A` to `C`, `Sword_Dash` and `Death01`. |
| Wolf, Deer | Quaternius models from Poly Pizza, or the fallback in risk 8 (section 8). | Animals cannot share the human skeleton. Their license, clips and look next to the humans are all unseen. |
| Plate armor and robes | 1. Stay on the free tier. 2. Pay $20 for the Source tier of Modular Character Outfits - Fantasy, which has full armored knight and wizard outfits. | The free tier has no plate armor or robes, so today a male Juggernaut has a bare torso and the Mage wears a Peasant outfit. The license of the paid tier has not been verified (section 5.3). |
| Props | Keep KayKit Dungeon and Halloween, scaled per section 5.4. | Not yet judged next to the humans. |

The quickest way to decide is one screenshot with a player, a Husk on the human kit and a correctly scaled KayKit skeleton side by side.

---

## 6. Milestones

### Who owns what

Everyone commits their own work with their own git identity. Each person also presents their area. If the team prefers a different split, swap names, but keep ownership distinct, since the course compares commits against each person's claimed work.

| Person | Owns | Main files |
|---|---|---|
| **Tabshir Khandaker** | Networking and server combat: health and magic in the sim, hit resolution, downed and revive, binary snapshots, interest management, deployment, nginx, load testing, touch controls, quick start. Objective 1 and the Objective 4 backup. | `shared/sim.ts`, `shared/protocol.ts`, `server/src/app/realtime.ts`, `server/src/app/world/{combat,interest,snapshot}.ts`, `server/loadtest`, `nginx`, `compose.prod.yml`, `client/src/game/touch.ts` |
| **Kristian Schuchman** | World and graphics: map build script, collision, zones and props, asset pipeline, fog, Binary Dust effect, weapon tier visuals, telegraph decals, crowd level of detail, shader. Objective 4 primary. | `scripts`, `tools`, `shared/collision.ts`, `shared/mapData.ts`, `client/src/game/{mapView,dustFx,telegraphs,psxRenderer,world}.ts`, `client/public/models` |
| **Ryan Chan** | Enemies and progression: enemy AI, Ashen Sovereign, dust, loot, inventory, bonfire menu, stat upgrades, potions, death and stains, achievements, HUD, database migration, balance. | `shared/combat.ts`, `shared/enemies.ts`, `server/src/app/world/{enemies,boss,loot,persist}.ts`, `server/migrations/002_game.sql`, `client/src/components` |

**Working rules:** a branch per feature, and pull requests into the default branch. Report links must point to commits on the default branch, so merge often. No one commits for someone else. Run `server/test` before merging. After every milestone, one person does a fresh clone and runs `docker compose up`, because graders test a clean clone and untracked files will not be there.

### M0: Safe ground (Thu Nov 5 to Sun Nov 8)

| Who | Work |
|---|---|
| All | Get this code into the team's public GitHub repo. Confirm Team Formation and Team Details forms are in. Sign up for a presentation slot, and note its date. Complete the required hand downloads. |
| Tabshir | Rent a server (4 dedicated vCPU, 8 GB, 1 Gbps) and a domain. Deploy with `compose.prod.yml`, get a Let's Encrypt certificate, put the link in the README, test `wss://`. The nginx limits are already raised (section 8). Send the staff question. First bot script in `server/loadtest`, 50 bots from a second machine as a baseline. |
| Kristian | Lead the enemy and animal art decisions in section 5.5, starting from one side-by-side screenshot, and give Ryan the answer before M1. Asset pipeline script. Convert one prop and the Wolf end to end and view them in-game. Agree on the `mapData.ts` format. Split `GameClient.ts` into modules. |
| Ryan | `shared/combat.ts` and `shared/enemies.ts` with this document's numbers and unit tests for formulas. Write `002_game.sql`. |

**Done when:** a fresh clone runs. `https://<domain>` has a valid certificate and HTTP redirects to it on the same path. Security tests pass against the deployed site.

### M1: Combat that counts for Objective 3 (Mon Nov 9 to Sat Nov 14)

| Who | Work |
|---|---|
| Tabshir | Health and magic in the sim. Melee hit resolution. Downed and revive. Binary snapshots, interest grid, backpressure, roster and map. 100-bot test. |
| Kristian | Collision on server and client. Greybox map: all zones walkable as simple shapes. Zone fog. Bonfire model. Camera pull-in. Pick the boss body. |
| Ryan | Enemy framework with Minion, Wolf and Deer. Dust drops, private messages, HUD with live health, magic and stamina bars and dust count. |

**Done when:** two browsers on the **deployed** site kill the same skeleton and see each other's hits, one gets downed, and the other revives them. **Objective 3 is met from this point**, and 17 days remain as buffer. Tag it `m1`.

### M2: The game loop (Sun Nov 15 to Fri Nov 20)

| Who | Work |
|---|---|
| Tabshir | Settle the Ranger's weapons with the team (section 1.3). Projectiles, per-class attack numbers, Joint Strike, block. Reconnect behavior. 200-bot test, register storm, page-load storm. |
| Kristian | Dressed village, forest, graveyard and meadow. Binary Dust effect. Weapon tiers visible on the weapons that are already attached. First visual review: one screenshot per zone. |
| Ryan | Husk, Rogue, Skeleton Mage, Warrior, Revenant. Bonfire menu with upgrades and travel. Potions. Loot and inventory. Death and Bit Stains. Achievements wired up. |

**Done when:** a new player can go from spawn to the citadel gate, earn dust, upgrade a stat at a bonfire, die and get their dust back, and equip a looted Iron weapon. README Objective 4 is drafted.

### M3: The boss and feature freeze (Sat Nov 21 to Wed Nov 25)

| Who | Work |
|---|---|
| Ryan | Ashen Sovereign: all states, 3 attacks, phase 2, crowd scaling, rewards, health bar. Specials if on track. |
| Kristian | Citadel and Throne of Ash. Telegraph decals. Boss visuals and phase shift. Crowd level of detail. Lazy loading. Final art pass. |
| Tabshir | Touch controls. Guest quick start. 200 bots all in the arena. Load shedding and queue at 300. |

**Done when:** three people beat the boss on the deployed site, and a phone can join and play. **Feature freeze at the end of Wed Nov 25.** Thanksgiving is Thu Nov 26, so assume less time after this.

### M4: Hardening (Thu Nov 26 to Mon Nov 30)

Bug fixes only. No new features.

| Who | Work |
|---|---|
| Tabshir | 300-bot 20 minute soak. Fresh clone test. Security tests on the deployed site. Check certificate expiry and auto-renewal. |
| Kristian | Low-end laptop and phone pass (iOS and Android). Final visual pass. Credits page complete. |
| Ryan | Balance from playtests. Boss respawn setting for the demo. Full run of the demo script. |
| All | Rehearse 8 to 10 minutes on Sun Nov 29, with even speaking time. **Write and submit individual reports and peer evaluations by Mon Nov 30.** |

**Final merge: Mon Nov 30 at 9:00 PM.** Graders take the latest commit before Dec 1 at 9:00 AM, so nothing risky should be pushed overnight. The team should confirm the presentation date from the sign-up, since the assignment text read for this plan did not give one.

### Presentation outline

| Part | Who | Content |
|---|---|---|
| Opening, 2 min | Kristian | World, classes, the PS1 pipeline. Toggle the dither shader live to show Objective 4 evidence. |
| Combat, 2.5 min | Ryan | Fight, dust, upgrade, looted weapon, boss telegraphs, phase 2. |
| Tech, 2.5 min | Tabshir | Revive with a teammate live. Auth and deployment summary. Load-test graph. |
| Close, 1 min | All | Status of anything incomplete. |
| User Tests | All | **Reveal the URL only now** on a QR code slide. |

Run the demo in a fullscreen browser with no address bar, since the URL must stay hidden during the demo.

### If behind schedule

Check on Nov 20. Cut from the top of this list down:

1. Sovereign weapon motes
2. Night gameplay bonuses (the visual cycle stays)
3. Class specials
4. Block (also edit `Hud.tsx`)
5. Fast travel
6. Skeleton Mage, then Rogue
7. Visual terrain height
8. Chests (move their tiers to drops)

**Never cut:** deployment, combat, revive, collision, interest management, load testing, dust and upgrades, potions, weapon tiers, health and magic bars, or the boss with all 3 attacks and the speed-up at half health.

### Load-test targets

Bots run from **one other machine, on one IP, through nginx**, the same as a shared campus address. Each bot uses a real account and JWT, sends 30 Hz input, attacks and dodges. Results get written down, since they are demo evidence.

**Measured so far (Nov 5).** 60 simulated players moving at 30 inputs per second: app container about 6% CPU on this laptop, 14.8 snapshots per second per client, 41 KB/s down per client, no disconnects. All of it ran on one machine, so it does not measure real network conditions. It is a movement test, and the bots below also attack and dodge. Its script is not in the project folder, so `server/loadtest` still needs writing.

| By | Test | Pass |
|---|---|---|
| Nov 8 | 50 bots on today's code, from a second machine | Baseline recorded. The one-machine run above does not count. |
| Nov 14 | 100 bots, 60 enemies | p99 tick <= 20 ms, <= 20 KB/s per client, zero 429s |
| Nov 20 | 200 bots, whole map | p99 tick <= 25 ms, under 1% of ticks overrun, memory <= 1.5 GB |
| Nov 20 | 200 accounts register and log in within 60 s | No 429 or 500, p95 login <= 2 s, tick p99 unaffected |
| Nov 20 | 200 page loads within 60 s | No 429 |
| Nov 25 | 200 bots all in the boss arena | p99 tick <= 30 ms, <= 20 KB/s per client |
| Nov 28 | 300 bots, 20 minutes | No crash, p99 tick <= 33 ms, memory flat |

Client targets by Nov 28: 30 fps on Intel UHD 620 with 40 players in view. 25 fps on a mid-range phone. First playable frame within 15 s at 10 Mbit/s.

The audience size is not known. 200 is the plan, and 300 is the safety margin. The queue screen handles anything above that.

---

## 7. Objective mapping

Status as of Nov 5. "Built" means the code and README say so, and the local stack answered on port 8080 today, but this plan did not re-test every line. `server/test` has 76 passing tests on the local stack. M0 re-runs them against the deployed site.

| Requirement | Status | How it is met |
|---|---|---|
| **Objective 1: Deployment** | | |
| Web framework | Built | Express 5 in `app` and `auth` |
| `docker compose up` on 8080 | Built | `compose.yml`. Re-test from a fresh clone at every milestone. |
| nginx reverse proxy | Built | Own container |
| Database in own container | Built | `postgres:17-alpine` |
| README with setup | Built | Update when nginx becomes a build target |
| Home page at `/` | Built | |
| Public server with domain | **Not done** | M0, Nov 8 |
| Valid HTTPS | **Not done** | Config in `nginx/prod.conf.template`. M0. |
| HTTP redirects to the same path on HTTPS | Config only | Verify after deploying |
| Deployed link in README | **Not done** | Placeholder today |
| Database not reachable publicly | Built | No published port, internal network |
| TLS key not committed | Built | `.gitignore` covers `*.pem`, `*.key`, `certbot/`. Check the repo once it exists. |
| Homework security rules | Built | `server/test/security.test.ts`. Extend per section 4.10. |
| **Objective 2: Auth** | | |
| Register, login, logout, visible username | Built | |
| Survives restart | Built | Keys and data on volumes |
| Separate auth container, nginx routing | Built | `nginx/snippets/routes.conf`. If a quick start route is added, route it to auth too. |
| RS256, private key only on auth, public key by volume | Built | |
| `exp` checked, bad signature and wrong algorithm refused, no database lookup for identity | Built | `server/src/shared/jwt.ts` |
| **Objective 3: WebSockets** | | |
| Shared visual space, all users visible | Built, extension planned | Two real browser players were verified seeing each other on port 8080 with security headers on. Interest management, once built, narrows snapshots, so the 1 Hz roster and map keep every user visible |
| Real-time broadcast, simultaneous actions | Built | 30 Hz server, 15 Hz snapshots. Measured 14.8 per client with 60 simulated players on one machine. |
| **Interaction beyond moving, latency-sensitive** | **Not done** | Co-op combat. Revive (hold within 2.5 u for 2.5 s, interrupted by hits), Joint Strike (a second player's hit within 0.6 s), boss threat, Ward and Marked Prey. M1 delivers revive and shared enemies. |
| Would a half-second delay feel broken? | Passes after M1 | Dodge windows are 0.25 to 0.29 s, and the fastest telegraph is 0.5 s |
| Auth checked at handshake, username from JWT | Built | `realtime.ts` |
| WSS through nginx, plain WS locally | Config only | Verify at deployment |
| **Objective 4: Make it interesting** | **Needs staff confirmation** | Below |
| README Objective 4 section | Placeholder | Draft by Nov 20 |
| **Presentation** | | |
| Demo, 10 points | Not started | Outline above. Rehearse Nov 29. |
| User Tests, 10 points | At risk until M1 | Sections 4.4, 4.9 and the load tests |
| All three speak, roughly equal | Planned | Outline above |
| Valid HTTPS, or the presentation is 0 | **Not done** | M0 |
| URL hidden until after the demo | Planned | Fullscreen browser, QR afterward |
| **Individual** | | |
| Report with commit links, peer evaluations | Not started | Due by the deadline, plan to submit Nov 30 |
| Commits on the default branch under your own name | **Blocked** | No repository in this folder yet |

### Objective 4 recommendation

**Primary: Graphics and Interaction.** The hand-written PS1 render pipeline in GLSL: low-res target, vertex snapping, ordered dithering, and the GPU-instanced Binary Dust shader. It connects to Objective 3 because it draws the live shared world, and bursts are triggered by other players' kills over the WebSocket. Show it by toggling the pass on and off during the demo.

The weak point is that the assignment says frameworks do not count, and a grader could see this as "just Three.js". So the claim must rest on the custom shaders, not on using the library.

**Backup: Systems and Networking.** Client prediction with server reconciliation, spatial interest management, the binary protocol and the load-test graphs. This needs no extra work since M1 builds it anyway.

**Ask staff now.** Draft:

> Our Objective 4 is a hand-written PS1-style rendering pipeline in GLSL (low-res render target, vertex snapping, ordered dithering, a GPU-instanced particle shader), used through Three.js to draw our real-time shared world. Does this qualify under Graphics and Interaction? If Three.js makes it count as a framework, would client prediction with server reconciliation plus spatial interest management qualify under Systems and Networking instead?

Write the answer into the README.

---

## 8. Top risks

| # | Risk | Likelihood / damage | Mitigation | Owner |
|---|---|---|---|---|
| 1 | **Scope.** A 26 day schedule for 3 people has a world, 8 enemy types, a boss and loot. | High / High | Order protects grades first: deployment by Nov 8, Objective 3 by Nov 14. Greybox map before any art. Cut list decided now and checked on Nov 20. Freeze on Nov 25. | All |
| 2 | **Audience on one IP. The nginx limits were fixed on Nov 5.** The old rules would have refused a lecture hall. Static paths now skip the request limit, `limit_conn` is 2,000 and `worker_connections` is 8,192 (details below). It has not been proven from a real shared IP yet. | Was High / High. Now Medium / High until tested. | Prove it with load tests from one IP on a second machine: the page-load and register tests in section 6. Keep timeouts and body limits. Login throttling per IP plus username already covers brute force. | Tabshir |
| 3 | **Server overload in the hall.** Today's snapshots are O(n^2), and the game loop shares one Node thread with the REST API and static files. A registration burst (bcrypt cost 12) also competes for CPU. | High / High | Section 4.4 interest design, which is not built yet. Static moved to nginx, which is not done either (details below). In `compose.prod.yml`, pin `app` to its own cores with `cpuset` so `auth` hashing cannot starve the tick. Skip snapshots to slow clients, who today are only dropped above 1 MB. Shed in stages and queue above 300. The Nov 5 measurement of about 6% CPU at 60 players is from one laptop, with no combat running. | Tabshir |
| 4 | **Performance on school laptops.** Too many skinned characters and draw calls. `frustumCulled = false` draws everyone. | High / Medium | Section 4.9 budgets, crowd level of detail, material cache, test on real low-end hardware by Nov 25. Show frame time in a debug readout from M1. | Kristian |
| 5 | **Phones have no keyboard, and iOS has no pointer lock.** Much of the audience will open the link on a phone. | High / Medium | M3: on `pointer: coarse`, skip pointer lock and show a left joystick, right-side camera drag, and buttons for attack, dodge, potion, interact and special. Aim snaps to the nearest enemy within 25 degrees. Phone limits: 8 skinned characters of each kind, 1,500 particles. Test on one iPhone and one Android by Nov 25. | Tabshir |
| 6 | **Slow download on hall Wi-Fi.** 200 people share an access point, and full assets are large. | Medium / High | 5 MB to first playable frame, the rest in the background with placeholders. Long cache headers. Precompressed gzip. | Kristian |
| 7 | **Asset style mismatch.** The user rejected the KayKit players as cartoony, and the enemies and props planned so far still come from KayKit. Apart from the player models and weapons, nothing has been visually judged. | High / High, since the user wants it fully polished | The Quaternius humans are now the anchor. Settle section 5.5 by Nov 8, and prefer human-proportioned enemies. One color grade, 128 px textures, same material and fog for all. At most 3 art sources per zone. Review a screenshot per zone on Nov 14 and Nov 20, and remove what stands out. No free pack gives a complete dark PS1 cast, so grading plus the shader carries the look. | Kristian |
| 8 | **Poly Pizza models fail to work out** (license not CC0, no usable clips). Licenses are unread, and clips are unknown. | Medium / Medium | Check by Nov 8. Husk can use the human kit with the `Zombie_*` clips, with a tinted Minion as the last resort. Boss already uses a confirmed model. Wolf and Deer are the real gap, as the user asked for animals: if they fail, search for another CC0 animated animal by Nov 10, and if none, code a simple low-poly wolf and deer with leg motion. | Kristian |
| 9 | **Objective 4 rejected.** | Medium / High | Ask by Nov 6. Backup claim already gets built. | Tabshir |
| 10 | **Grades on individual commits.** Most code so far was written in this one folder, and it is not a repository yet. | High / High | M0 repo setup. Each person's commits from M0 on come from their own account, in their own area. Everyone must understand their part for the report, the presentation, and any staff follow-up. | All |
| 11 | **Security rule zeroes everything.** New messages and pages add surface. | Low / Very high | Section 4.10. No free text in the protocol. Tests added with each feature. | All |
| 12 | **Audience onboarding is slow.** Registering and creating a character takes minutes out of a short User Test. | Medium / Medium | Quick start button on the home page: the auth server creates a real account with a generated name such as `Ashen4821` and a random password, and sets the normal JWT, so all auth rules still hold. The class screen comes next, with defaults ready. Such an account cannot be logged back into after its JWT expires, which is fine for a demo. Keep normal registration too. | Tabshir |

### Nginx state for risk 2

Done on Nov 5:

| Setting | Before | Now | File |
|---|---|---|---|
| App requests per IP | 100/s, burst 300 | 200/s, burst 1,000 | `nginx/snippets/http_context.conf`, `routes.conf` |
| Auth requests per IP | 10/s, burst 60 | 20/s, burst 200 | Same |
| Connections per IP | 300 | 2,000 | `nginx/snippets/server_common.conf` |
| Worker connections | 1,024 | 8,192, with `worker_rlimit_nofile 20000` | `nginx/nginx.conf` |
| `/assets`, `/models`, `/audio`, `/icons`, `/avatars` | Under the request limit | No request limit | `nginx/snippets/routes.conf` |

The app and auth rates are lower than this plan first proposed (1,000/s and 50/s). Files no longer count toward them, and the load tests decide whether they need raising.

Still not done: files pass through nginx to the app's Node process, which also runs the game loop (risk 3). If the load tests show that hurting the tick, serve them from nginx instead, with a new Dockerfile target that copies `client/dist` into the nginx image:

```nginx
# routes.conf: replaces the current files location. Paths must match the build output.
location ~ ^/(assets|models|icons|audio)/ {
    root /srv/public;
    gzip_static on;
    expires 7d;
    # no limit_req here on purpose
}
# /avatars stays proxied to the app, since uploads live on the app's volume.
```

Auth routes must still go only to `auth`, and the app must never receive them.
