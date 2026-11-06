# Game assets

3D source files for later milestones: the map, village, woods, graveyard, boss arena, props and enemies. There are 310 models in four packs, 29.2 MB in total, all CC0. Downloaded on 5 November 2026 from the `main` branch of each repo.

## These are not used by the game yet

Nothing in the game loads from this folder. When a milestone needs a model, copy it into the client's own assets at that point.

The Docker build ignores this folder, because `game-assets` is listed in the repo's `.dockerignore`. None of these files end up in an image.

## The packs

| Folder | Source | License and exact wording | What it contains | Size | Rig and animation clips | Meant for |
| --- | --- | --- | --- | --- | --- | --- |
| `kaykit-skeletons` | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 | CC0. `License: (Creative Commons Zero, CC0)` | `characters/`: 4 rigged GLBs (Mage, Minion, Rogue, Warrior). `weapons/`: 13 glTF props (arrows, axe, blade, crossbow, quiver, shields, staff) with their `.bin` files and texture | 18.69 MB | Characters: skin with 41 joints, and the same 95 clips on all four (listed below). Weapons: no skin, no clips | Skeleton enemies in the graveyard and woods, and minions in the boss arena |
| `kaykit-dungeon-remastered` | https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | CC0. `License: (Creative Commons Zero, CC0)` | 203 GLBs: 34 floors, 32 walls, 8 stairs, pillars and columns, 42 banners, torches, candles, tables, chairs, beds, shelves, barrels, crates, kegs, chests, trunks, coins, keys, rubble | 8.64 MB | No skin, no clips on any file | Boss arena and throne room. The furniture and barrels also suit the village |
| `kaykit-halloween-bits` | https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0 | CC0. `License: (Creative Commons Zero, CC0)` | 63 glTF models with their `.bin` files and texture: graves, gravestones, coffins, crypt, shrines, fences, gate arch, bones, skulls, lanterns, pumpkins, 10 dead and pine trees, dirt floors, paths | 1.29 MB | No skin, no clips on any file | Graveyard. The trees and paths also suit the woods and the map |
| `kaykit-adventures-weapons` | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0, folder `addons/kaykit_character_pack_adventures/Assets/gltf` | CC0. `License: (Creative Commons Zero, CC0)` | 27 glTF props with their `.bin` files and 4 textures: swords, axes, dagger, crossbows, arrows, quiver, shields, staff, wand. The same folder also holds mugs, spellbooks and a smoke bomb, so those came too | 0.53 MB | No skin, no clips on any file | Player and NPC gear, and loot. The mugs suit the village |

Animation names and skin status were read from each model's own JSON, not from memory.

## Skeleton animation clips

All four characters in `kaykit-skeletons/characters/` have these 95 clips, with the same names in the same order:

```
1H_Melee_Attack_Chop, 1H_Melee_Attack_Jump_Chop, 1H_Melee_Attack_Slice_Diagonal,
1H_Melee_Attack_Slice_Horizontal, 1H_Melee_Attack_Stab, 1H_Ranged_Aiming,
1H_Ranged_Reload, 1H_Ranged_Shoot, 1H_Ranged_Shooting, 2H_Melee_Attack_Chop,
2H_Melee_Attack_Slice, 2H_Melee_Attack_Spin, 2H_Melee_Attack_Spinning,
2H_Melee_Attack_Stab, 2H_Melee_Idle, 2H_Ranged_Aiming, 2H_Ranged_Reload,
2H_Ranged_Shoot, 2H_Ranged_Shooting, Block, Block_Attack, Block_Hit, Blocking, Cheer,
Death_A, Death_A_Pose, Death_B, Death_B_Pose, Death_C_Pose, Death_C_Skeletons,
Death_C_Skeletons_Resurrect, Dodge_Backward, Dodge_Forward, Dodge_Left, Dodge_Right,
Dualwield_Melee_Attack_Chop, Dualwield_Melee_Attack_Slice, Dualwield_Melee_Attack_Stab,
Hit_A, Hit_B, Idle, Idle_B, Idle_Combat, Interact, Jump_Full_Long, Jump_Full_Short,
Jump_Idle, Jump_Land, Jump_Start, Lie_Down, Lie_Idle, Lie_Pose, Lie_StandUp, PickUp,
Running_A, Running_B, Running_C, Running_Strafe_Left, Running_Strafe_Right,
Sit_Chair_Down, Sit_Chair_Idle, Sit_Chair_Pose, Sit_Chair_StandUp, Sit_Floor_Down,
Sit_Floor_Idle, Sit_Floor_Pose, Sit_Floor_StandUp, Skeleton_Inactive_Standing_Pose,
Skeletons_Awaken_Floor, Skeletons_Awaken_Floor_Long, Skeletons_Awaken_Standing,
Skeletons_Inactive_Floor_Pose, Spawn_Air, Spawn_Ground, Spawn_Ground_Skeletons,
Spellcast_Long, Spellcast_Raise, Spellcast_Shoot, Spellcast_Summon, Spellcasting,
T-Pose, Taunt, Taunt_Longer, Throw, Unarmed_Idle, Unarmed_Melee_Attack_Kick,
Unarmed_Melee_Attack_Punch_A, Unarmed_Melee_Attack_Punch_B, Unarmed_Pose, Use_Item,
Walking_A, Walking_B, Walking_Backwards, Walking_C, Walking_D_Skeletons
```

## License wording

The `LICENSE.txt` at the top of each repo was read before keeping the pack, and a copy sits in each pack's folder. All four carry the same three lines:

```
License: (Creative Commons Zero, CC0)
http://creativecommons.org/publicdomain/zero/1.0/
This content is free to use in personal, educational and commercial projects.
```

Each file also asks for credit to Kay Lousberg (www.kaylousberg.com) and says this is "not mandatory". Each repo's README adds "Licensed under CC0 1.0 Universal".

## Not downloaded: Quaternius models from Poly Pizza

Both `poly.pizza` and `static.poly.pizza` answered plain `curl` requests with HTTP 403 and a Cloudflare bot challenge (`cf-mitigated: challenge`). We did not try to get past it, so neither the license pages nor the model files could be read. These five are not in this folder, and their license, skin and animation names are unverified:

| Model | Page | File |
| --- | --- | --- |
| Skeleton | https://poly.pizza/m/DM4QScSmbS | https://static.poly.pizza/852e5efb-89a7-4e7c-af17-e9d3b8f6654b.glb |
| Zombie | https://poly.pizza/m/JoBvxIUpZP | https://static.poly.pizza/af74108f-e770-4ed0-9d17-83576afece78.glb |
| Wolf | https://poly.pizza/m/P1gU3Qkr9r | https://static.poly.pizza/f1d12388-e39b-4157-b32a-646a1d089fc4.glb |
| Deer | https://poly.pizza/m/T6Cs7tmMHJ | https://static.poly.pizza/4b6c2a41-43c7-404c-ae37-e8c4645ff93b.glb |
| Demon | https://poly.pizza/m/LnfIziKv4o | https://static.poly.pizza/46b52ba4-5d2a-4fc8-85cc-3e980f199141.glb |

To add one, open its page in a normal browser, confirm the license says CC0, and save the GLB into a new folder such as `game-assets/quaternius-wolf/`. Then read its animation names from the file and add it to the table above.

The Poly Pizza Boar was left out on purpose, because it was reported as CC-BY and unanimated.

## What is still missing

Without the Poly Pizza models there are no animals, zombies or demons here. None of the packs include village buildings either.

## Notes for using the files

- A `.gltf` file needs its `.bin` and texture beside it, because it refers to them by file name. A `.glb` file holds everything, including its texture.
- The skeleton characters have `handslot.l` and `handslot.r` joints for attaching weapons.
- Most dungeon files are named like `wall.gltf.glb`. They are real GLB files, and the odd name comes from the pack.
- `chest`, `chest_gold`, `floor_tile_big_spikes`, `wall_doorway` and `wall_doorway_scaffold` each have a separate moving part (lid, spikes or door) but no clips, so game code has to move that part.

## Left out on purpose

- FBX, OBJ, Unity and Godot files, and the pack preview images.
- `dungeon_texture.png` and the characters' copy of `skeleton_texture.png`, because the GLBs already contain them.
- The Adventurers character models, since only the weapons folder was asked for.

## How the files were checked

Every download matched the size and git hash in GitHub's file listing for its repo. All 207 GLB and 103 glTF files parse as glTF 2.0. Every `.bin` and texture they refer to is present in the same folder, and none of them refers to anything outside it.
