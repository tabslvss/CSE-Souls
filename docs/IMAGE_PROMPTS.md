# CSE Souls image prompts for ChatGPT

Every prompt below is self-contained and states its exact size, aspect ratio, transparency, composition, camera, lighting, palette and exclusions. The site already works without these images, and nothing breaks if you skip one.

## The look

Rich gold dark fantasy: luminous gold light through ash and fog, gold dust motes, thin elegant gold ornament and black backgrounds, all as painted dark fantasy concept art.

**This look is for website art only.** The 3D game itself stays PS1 low-poly, so nothing here changes how the game is drawn.

## Workflow

1. Open one new ChatGPT conversation and paste the **style lock**. Keeping everything in one conversation is what makes the set look consistent.
2. Paste one prompt at a time, in tier order. Tier 1 has by far the most visual impact.
3. Save each raw image to `client/art-source/` under the exact filename shown, then tell Claude. Claude optimizes it into `client/src/art/`.

## File names

The site looks up its art by base name, so these must stay exact:

`hero-citadel`, `logo`, `auth-background`, `land-village`, `land-forest`, `land-graveyard`, `land-citadel`, `land-throne`, `boss-sovereign`, `lost`

The class portraits, medallions, sigil, default avatar, panel frame, divider, portrait ring and flask icon are on the site too. To replace one, convert the new file to WebP and overwrite the file with the same name in `client/src/art`. `binary-dust`, `gate-sealed`, `ui-button`, `ui-bar-frame`, `texture-stone`, `icon-sword` and `icon-spell` aren't used yet: Binary Dust is animated in code, as designed.

## Sizes

ChatGPT's image tool generates in three fixed sizes, so every prompt asks for one of them. If your version offers something larger with the same aspect ratio, take it.

| Name | Pixels | Ratio | Used for |
|---|---|---|---|
| Landscape | 1536 x 1024 | 3:2 | Backgrounds, logo, wide UI |
| Portrait | 1024 x 1536 | 2:3 | Region cards, boss, lost page, class portraits |
| Square | 1024 x 1024 | 1:1 | Icons, frames, textures, Binary Dust |

## Fixing common problems

| Problem | Reply with |
|---|---|
| Wrong shape | `Regenerate at exactly 1536 x 1024 pixels, 3:2 landscape.` (use the right size) |
| Fake transparency (checkerboard or dark box) | `Regenerate with a real alpha-transparent background. Every pixel outside the object must be fully transparent, with no painted checkerboard, no background color and no drop shadow.` |
| Looks low-poly, retro or like a 3D render | `Repaint this as rich painted dark fantasy concept art with visible brushwork and luminous gold light through ash and fog. No low-poly facets, no pixels, no dither, no glossy 3D rendering.` |
| Too bright, or too much gold | `Darken it. Deepest shadows at #0A0908, with about 70% of the image in near-black shadow. Keep gold only where the light lands.` |
| Too dull, grey or muddy | `Add one clear source of luminous gold light #ECD59B falling through the fog, with fine gold dust motes where the light passes. Keep everything else near-black #0A0908.` |
| Gold looks yellow, orange or plastic | `Use only these golds: #F6ECD2, #ECD59B, #C9A45C, #7D5F2B. It should read as old worn metal and soft light, with no saturated yellow, no orange cast and no plastic shine.` |
| Unwanted text or symbols | `Remove all text, letters, numbers and rune-like symbols.` |
| A ring, halo or golden tree appears, or it resembles an existing game | `Remove every ring, halo, circular sigil and arc of light, and any golden or glowing tree. Redesign anything that resembles an existing game so this reads as an original world.` |
| Logo misspelled | `Spell it exactly C-S-E, then one space, then S-O-U-L-S. The first word is CSE and the second word is SOULS, ending in S. No other text.` |
| Binary Dust shows other characters | `Use only the digits 1 and 0. Remove every other digit, letter and symbol, and make the 0 a plain oval with nothing inside it.` |

---

## Style lock (paste this first)

```text
You will generate a set of images for one original dark fantasy game called CSE Souls. Apply all of these rules to every image in this conversation unless a prompt explicitly overrides one.

ART DIRECTION
Painted dark fantasy concept art, like a rich oil painting with visible confident brushwork. Black backgrounds. Luminous gold light falls through ash and fog. Fine gold dust motes hang in the air wherever light passes. Ornament is thin and elegant, drawn in fine gold lines. Forms are monumental and ancient, with crisp detail where light lands and soft lost edges where they dissolve into darkness. Every image is a painting, not a 3D render and not a retro game screenshot.

COLOR PALETTE (exact hex values)
- Near-black #0A0908: backgrounds and deepest shadows, covering most of every image
- Surface #181510: stone, armor and cloth in shadow
- Deep gold #7D5F2B: gold in shadow, dim haze, fog catching faint light
- Gold #C9A45C: the main gold, for metal, ornament and lit fog
- Bright gold #ECD59B: light itself, rim light, lit edges, dust motes
- Pale gold #F6ECD2: the hottest highlights only
- Ember #E08A3A: sparing accents only, such as small fires, sparks and tiny windows
- Blood #8A2F2F: sparing accents only, such as cloth and blood-red details
These eight colors and smooth blends between them are the whole palette. Gold leads. Ember and blood together never cover more than about 5% of an image. No saturated yellow, blue, green or purple.

LIGHTING AND MOOD
Low-key lighting with about 70% of the frame in near-black shadow. One clear source of luminous gold light falls through thick ash and fog, lifting the subject out of the black with soft shafts of light and thin rim light. Thick volumetric fog separates foreground, midground and background. The mood is melancholy, ancient and ruined grandeur. It is grim but not gory.

MATERIALS
Worn black stone, aged gold, blackened iron, cracked leather, weathered bronze, rotted timber, tattered cloth. Everything is old, chipped and covered in ash, but gold still catches the light.

ORIGINALITY
This is an original world, so nothing may copy an existing game. No ring-shaped sigils or logos. No rings, halos or arcs of light in the sky or behind figures. No giant golden tree, and no glowing tree of any kind. No characters, logos, creatures, symbols or designs from any existing game, and no imitation of any one existing game's look.

TRANSPARENT IMAGES
When a prompt asks for real alpha transparency, the image holds only the object on fully transparent pixels, with no fog, no dust, no glow haze, no painted checkerboard and no dark box, unless that prompt says otherwise.

ALWAYS EXCLUDE
No text, letters, numbers, rune-like symbols, logos, signatures, watermarks, borders, frames, UI, modern objects, anime or cartoon styling, photorealism, glossy 3D rendering, low-poly facets, pixel art, dither patterns, lens flares, chromatic aberration, shallow depth-of-field blur, gore.

Reply only with "Ready", then wait for my prompts. Generate exactly one image per prompt.
```

---

## Tier 1: the landing page

### `hero-citadel.png`

Landing page background. It shows sharp and full-screen, with soft fog and gold dust added live on top and the site's dark veil over that: about 46% dark behind the title, up to 66% at the corners, and fading fully into the page background over the bottom 24% of the screen. A 16:9 screen crops this image to 1536 x 864, taking about 8% off the top and 8% off the bottom. The title sits over the calm center, and a stats strip covers the bottom 15% of the screen, which is everything below about 79% down in this image.

```text
Generate exactly one image at 1536 x 1024 pixels, 3:2 landscape, fully opaque, no transparency.

SCENE: A vast ruined gothic citadel on a jagged crag at dusk, seen across a valley of fog, with luminous gold light pouring through the ash behind it and a lone knight resting at a small campfire in the foreground.

FRAMING: The image is shown sharp and full-screen, cropped to 16:9, which removes about 8% from the top and 8% from the bottom. The game title sits over the center of the frame. A statistics strip covers everything below 79% down. The site also darkens the center and corners and fades the bottom into black, so the sky and citadel must stay bright enough to survive that. Place nothing important in the cropped areas, in the calm center or under the strip.

COMPOSITION, using percentages of the full frame:
- Calm center, from 24% to 66% across and 18% to 72% down: only sky, thin fog and dim gold haze. No objects, no hard edges, no strong contrast, and nothing brighter than gold #C9A45C, because the title must stay readable here.
- Citadel: right side, spanning 66% to 96% of the width. Its tallest spire reaches 14% from the top and its base meets the fog at 62% from the top.
- Campfire and knight: lower left, centered at 14% across and 66% down. The seated knight is small, about 8% of the frame height, in side profile facing the fire, with his sword resting across his knees.
- Foreground: a barren near-black ridge whose top edge runs from 66% down at the left to 74% down at the right, filling everything below it. Two dead twisted leafless trees frame the edges at 4% and 97% across. Three leaning wooden grave crosses, each about 5% of the frame height, stand on the ridge line at 20%, 23% and 88% across. Below 79% down the ridge is plain dark ground with no detail.
- Background: two overlapping layers of mountain ridges fading into haze between 48% and 62% down, with very low contrast where they pass behind the calm center.

CAMERA: Eye level from the ridge, 24mm wide-angle equivalent, level horizon at 62% down, deep focus with everything sharp.

CITADEL DETAIL: Nine towers of varied height, three with steep pointed spires and two snapped off with jagged broken tops, connected by flying buttresses and a crenellated curtain wall with collapsed sections. Stone in near-black #0A0908 and surface #181510, with thin rim light in bright gold #ECD59B on every edge facing the light and fine gold #C9A45C tracery on the two tallest spires. Six to eight tiny windows glow ember #E08A3A. It reads as a nearly solid silhouette.

LIGHTING: A low sun sits hidden behind the citadel at 80% across and 50% down. The sky runs from near-black #0A0908 at the top, through surface #181510 and deep gold #7D5F2B, to gold #C9A45C at the horizon, reaching bright gold #ECD59B and pale gold #F6ECD2 only directly behind the towers. Soft shafts of gold light fan out to the left through the ash and fade away before reaching 50% across. Narrow bars of dark ash cloud cross the sky. The campfire throws a small warm pool of ember #E08A3A light, radius about 7% of the frame width, onto the ground and the knight's side.

ATMOSPHERE: Two fog layers, one at the citadel's base and one in the valley in front of it. About 200 fine gold dust motes in bright gold #ECD59B float in the shafts of light, thinning to almost none in the calm center. Faint ash particles throughout, and about 20 tiny ember sparks rising from the campfire.

STYLE: Painted dark fantasy concept art with visible brushwork, luminous gold light and soft lost edges in the shadows.

EXCLUDE: text, logos, characters other than the one knight, a sword stuck in or beside the fire, birds, blue sky, green vegetation, any giant or golden tree, any ring, halo or circle of light in the sky, lens flare, border.
```

### `logo.png`

The title on the landing page, shown up to about 1100 pixels wide. Claude trims the empty space around it. Check the spelling letter by letter: C-S-E, space, S-O-U-L-S. If it stays wrong after two tries, skip it, since the typeset title already works.

```text
Generate exactly one image at 1536 x 1024 pixels, 3:2 landscape, as a PNG with a real alpha-transparent background. Every pixel outside the lettering and its ornament must be fully transparent, with no painted checkerboard and no background color.

OVERRIDE: This image is the game's title logo, so the style lock's rules against text and logos do not apply to these two words. They still apply to everything else.

SUBJECT: A game title logo containing exactly two words in capital letters: CSE SOULS. Spell it exactly C-S-E, then one word space, then S-O-U-L-S. That is three letters, a space, then five letters, eight letters in total. The last letter is S. No other words, hyphens or punctuation anywhere.

LAYOUT: Both words sit on a single straight horizontal line, centered both ways, spanning 90% of the image width (about 1380 pixels), with cap height about 16% of the image height (about 165 pixels). Letter spacing is wide and even, with about 12% of the letter height between letters. The word space is about 70% of the letter height. Centered 3% below the words, a very thin ornamental gold line about 40% of the image width, with a small diamond at its center, tapering to nothing at both ends. The rest of the image stays empty and transparent.

LETTERFORMS: Monumental engraved Roman inscription capitals with sharp triangular serifs and strong contrast between thick and thin strokes, like letters carved on an ancient imperial monument. Elegant and restrained. Not blackletter, not gothic script, not a fantasy font with swashes. The O is a plain letter O with nothing inside or around it.

MATERIAL: Cast from old luminous gold. The face of each letter runs from pale gold #F6ECD2 at the top, through bright gold #ECD59B and gold #C9A45C, to deep gold #7D5F2B at the bottom. Beveled edges about 6 pixels wide catch thin pale gold #F6ECD2 highlights. The surface is slightly worn, with a few fine cracks carrying a faint ember glow #E08A3A. A thin near-black #0A0908 outline about 3 pixels wide separates the letters from any background.

CAMERA: Straight-on, zero perspective, perfectly level.

LIGHTING: Soft gold light from directly above, with no cast shadow.

STYLE: Painted aged gold lettering for a dark fantasy title screen, rich and luminous.

EXCLUDE: any text other than CSE SOULS, any ring, circle, arc or sigil around or inside a letter, background color, fog, dust, glow haze, drop shadow beyond the letters, characters, swords, or other objects.
```

### `sigil.png`

The brand mark in the navigation bar (about 32 x 32 pixels), on the login form (44 x 44 pixels) and as the browser tab icon (64 x 64 pixels). It must stay readable when tiny.

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, as a PNG with a real alpha-transparent background. Every pixel outside the emblem must be fully transparent.

OVERRIDE: This is the game's one brand emblem, so the style lock's rule against logos does not apply to it. It is a diamond, never a ring or circle.

SUBJECT: A heraldic emblem: a single upward flame inside a diamond frame (a square rotated 45 degrees).

LAYOUT: Perfectly centered and left-right symmetrical. The diamond's four points touch 4% from each edge of the image. The frame is a band about 5% of the image width, with a thin parallel inner line 3% inside it. The flame is centered, with height about 48% of the image and width about 26%, formed of three bold simple tongues.

COLOR AND MATERIAL: The frame is gold #C9A45C with deep gold #7D5F2B in the recesses and a bright gold #ECD59B line on its upper edges, like a worn antique coin. The flame's outer shape is bright gold #ECD59B and its inner core is pale gold #F6ECD2. The space between flame and frame is fully transparent.

CAMERA: Straight-on, no perspective.

LIGHTING: Soft and even, with no cast shadow.

STYLE: Bold flat shapes with a slight painted bevel, like an old gold seal. Very high contrast and simple, so it reads clearly when shrunk to 32 pixels.

EXCLUDE: text, letters, rings, circles, fine detail, thin lines under 2% of the image width, background, shadow, fog, dust.
```

### Region cards

Five cards on the landing page, shown sharp at up to about 280 x 450 pixels. The sides get cropped slightly, a small area number sits at the top center, and text covers the bottom half with a dark fade, so the subject must sit in the **top 50%**. Each card is generated separately.

### `land-village.png`

Forsaken Village: "The starting area. Learn to fight against weak undead in the ruins."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SCENE: The Forsaken Village, a burned medieval village at dusk, looking down its one muddy road toward low gold light.

COMPOSITION: All subject matter sits in the top 50% of the frame. Keep the left and right 6% free of anything important. The bottom 50% is only dark muddy ground fading to near-black #0A0908, with no detail that competes with text placed over it.
- Three ruined timber houses, one on the left and two on the right, with roofs burned down to bare black rafters. Their ridgelines sit about 22% from the top.
- One small window in the far right house still glows ember #E08A3A.
- The road runs from the bottom center to a vanishing point at 50% across and 38% down.
- A single small shambling undead silhouette stands in the road at the vanishing point, about 8% of the frame height.

CAMERA: Eye level, 28mm equivalent, deep focus, slight one-point perspective.

LIGHTING: A low gold dusk glow behind the houses, centered at 60% across and 32% down, in bright gold #ECD59B at its core and gold #C9A45C around it. The sky runs from near-black #0A0908 at the top, through surface #181510 and deep gold #7D5F2B, to gold #C9A45C at the horizon. Buildings are near-silhouettes in #0A0908, with thin bright gold #ECD59B rim light on the rafters.

ATMOSPHERE: Grey-gold ash drifting down, thin smoke rising from two houses, low fog across the road catching deep gold #7D5F2B light, and fine gold dust motes in the glow.

STYLE: Painted dark fantasy concept art with visible brushwork, luminous gold light and soft lost edges in the shadows.

EXCLUDE: text, people other than the one undead figure, bright colors other than gold, green plants, any ring or halo around the light, border.
```

### `land-forest.png`

Cursed Forest: "Hunt deer and wolves to earn XP and level up."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SCENE: The Cursed Forest at twilight, with a pale deer frozen in a shaft of gold light as eyes watch from the dark.

COMPOSITION: All subject matter sits in the top 50% of the frame. Keep the left and right 6% free of anything important. The bottom 50% is only dark forest floor fading to near-black #0A0908.
- Enormous leafless black trunks rise past the top of the frame in three depth layers: pale and foggy in the distance, near-black up close. Two large foreground trunks frame the left and right edges.
- A pale deer stands in side profile at 50% across and 38% down, about 14% of the frame height, in a single soft vertical shaft of bright gold #ECD59B light. Its coat is pale gold #F6ECD2 where the light lands.
- Three pairs of tiny glowing ember #E08A3A eyes hide in the darkness between the trunks, at about 18%, 30% and 80% across, each pair only a few pixels wide.

CAMERA: Low eye level, 35mm equivalent, deep focus.

LIGHTING: A dim glow in deep gold #7D5F2B comes from behind the deep trees. The one shaft of bright gold #ECD59B falls from above onto the deer. Foreground trunks are near-silhouette #0A0908, with faint gold #C9A45C rim light on the edges nearest the shaft.

ATMOSPHERE: Dense layered fog between each depth layer of trees, blending from surface #181510 to deep gold #7D5F2B, thickest around the deer. Hundreds of fine gold dust motes float in the shaft of light.

STYLE: Painted dark fantasy concept art with visible brushwork, luminous gold light and soft lost edges in the shadows.

EXCLUDE: text, leaves, green, golden or glowing trees, a giant central tree, hard-edged light rays, wolves shown clearly, border.
```

### `land-graveyard.png`

Sunken Graveyard: "Skeleton archers attack from a distance, so keep moving."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SCENE: The Sunken Graveyard, flooded and still under a huge pale gold moon, watched by a skeletal archer.

COMPOSITION: All subject matter sits in the top 50% of the frame. Keep the left and right 6% free of anything important. The bottom 50% is still black water with faint reflections, fading to near-black #0A0908.
- A huge full moon centered at 62% across and 20% down, with diameter about 26% of the frame width.
- Tilted stone crosses and tombstones rise from still water at various angles, spread across the frame between 34% and 50% down.
- A small stone crypt at 28% across and 36% down, half sunken, with a skeletal archer silhouette standing on its roof, about 11% of the frame height, bow held low.
- One dead leafless tree on the left edge.

CAMERA: Eye level just above the water, 28mm equivalent, deep focus.

LIGHTING: Gold moonlight from behind. The moon is pale gold #F6ECD2 with a soft glow in bright gold #ECD59B that fades smoothly into the sky, with no visible ring. The sky runs from near-black #0A0908 at the top, through surface #181510, to deep gold #7D5F2B at the horizon. All objects are rim-lit in bright gold #ECD59B and otherwise near-silhouette.

ATMOSPHERE: Low fog in deep gold #7D5F2B drifting on the water between the graves, and fine gold dust motes around the moonlit edges. The water is mirror-still, with a broken reflection of the moon in bright gold #ECD59B.

STYLE: Painted dark fantasy concept art with visible brushwork, luminous gold light and soft lost edges in the shadows.

EXCLUDE: text or inscriptions on the graves, stars, a ring or halo around the moon, blue tones, bright colors other than gold, gore, border.
```

### `land-citadel.png`

Fallen Citadel: "Armored knights guard the best loot in the game."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SCENE: The approach to the Fallen Citadel, a colossal ruined gothic fortress under an ash-black sky, with gold light burning behind its towers.

COMPOSITION: All subject matter sits in the top 50% of the frame. Keep the left and right 6% free of anything important. The bottom 50% is only a dark stone bridge deck fading to near-black #0A0908.
- The citadel fills the upper frame, its tallest spire at 4% from the top and its gate at 50% across and 44% down.
- A long stone bridge runs from the bottom center to the gate in strong one-point perspective.
- Four giant armored knight statues line the bridge, two per side, decreasing in size toward the gate. All are headless or broken.
- One small living armored knight stands guard at the gate, about 7% of the frame height.

CAMERA: Low angle looking up, 24mm equivalent, deep focus, strong converging verticals.

LIGHTING: The sky runs from near-black #0A0908 at the top, through surface #181510 and deep gold #7D5F2B, to gold #C9A45C at the horizon, with a thin sparing band of blood #8A2F2F haze low on each side. Behind the citadel, a bright gold #ECD59B glow silhouettes the towers. The structure is near-black #0A0908, with thin gold rim light and about five small windows lit in ember #E08A3A.

ATMOSPHERE: Fog in deep gold #7D5F2B around the citadel's base, ash falling, fine gold dust motes in the glow and a few faint ember #E08A3A sparks rising.

STYLE: Painted dark fantasy concept art with visible brushwork, luminous gold light and soft lost edges in the shadows.

EXCLUDE: text, banners with symbols, dragons, any golden tree, any ring or halo in the sky, bright colors other than gold, border.
```

### `land-throne.png`

Throne of Ash: "The boss arena. Everyone who gets here fights together."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SCENE: The Throne of Ash, a vast ruined throne hall seen from the foot of a long stone staircase, with an empty throne of black stone at the far end.

COMPOSITION: All subject matter sits in the top 50% of the frame. Keep the left and right 6% free of anything important. The bottom 50% is only wide dark steps fading to near-black #0A0908, with thin gold rim light on the step edges.
- The throne is centered at 50% across and 26% down, about 18% of the frame height, huge and spiked, with its back rising in jagged points. It is empty.
- Two rows of enormous columns recede toward the throne in one-point perspective, framing the center.
- The roof has collapsed above the throne, and a soft shaft of gold light with falling ash comes through.

CAMERA: Low angle at the base of the stairs, 24mm equivalent, deep focus.

LIGHTING: A strong gold glow behind and around the throne, pale gold #F6ECD2 at its hottest and bright gold #ECD59B around that, falling off quickly through gold #C9A45C and deep gold #7D5F2B into near-black #0A0908. Columns are rim-lit in bright gold #ECD59B on their inner edges only. About 80% of the frame is in shadow.

ATMOSPHERE: Hundreds of fine gold dust motes drifting around the throne, about 30 ember #E08A3A sparks, low gold-tinted fog on the steps, ash falling through the shaft of light.

STYLE: Painted dark fantasy concept art with visible brushwork, luminous gold light and soft lost edges in the shadows.

EXCLUDE: text, any figure on the throne, carpets, banners, any ring or halo behind the throne, bright daylight, border.
```

### `boss-sovereign.png`

The featured boss art on the landing page, shown up to about 465 x 600 pixels. That box can crop about 7% off the top and bottom, so the prompt keeps the crown and feet further in. This is the most important character image in the set.

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SUBJECT: An original boss character called the Ashen Sovereign: a colossal corrupted king in cracked black plate armor, standing before his throne, resting both gauntlets on the hilt of a broken greatsword.

COMPOSITION: Full body, centered and nearly symmetrical. The crown's top sits 10% from the top of the frame, and the feet 9% from the bottom, because the top and bottom 7% may be cropped. The figure's shoulders span 62% of the frame width. The sword is planted point-down on the center line, with its hilt at 42% down.

CHARACTER DESIGN:
- Head: a smooth faceless helm with a single thin horizontal slit glowing ember #E08A3A. A blackened gold crown has grown into the helm, with five uneven spikes.
- Armor: massive, angular black plate from near-black #0A0908 to surface #181510, with oversized spiked pauldrons and thin gold #C9A45C ornament along the plate edges. Long cracks across the chest, shoulders and thighs glow molten gold, bright gold #ECD59B at the edges and pale gold #F6ECD2 at the hottest points.
- Cape: a tattered royal cape in blood #8A2F2F, falling behind him, disintegrating into ash and gold sparks along its torn hem.
- Sword: a huge greatsword, broken a third of the way up, the separate point fragment still embedded in the floor just below it. Dark notched steel #181510 with a gold #C9A45C crossguard.
- The figure feels impossibly heavy, patient and ancient.

BACKGROUND: A dim stone throne hall. A dark spiked throne is partly visible behind him, and tall columns fade into near-black #0A0908 at the left and right edges.

CAMERA: Very low angle from floor level, 28mm equivalent, looking up, so the figure looms. Deep focus.

LIGHTING: Lit from below by gold glow on the floor and from the armor's own cracks. A thin bright gold #ECD59B rim light from behind separates his silhouette from the background. About 75% of the frame is in shadow.

ATMOSPHERE: Gold dust motes and a few ember #E08A3A sparks rising around him, ash drifting, low fog at his feet glowing deep gold #7D5F2B.

STYLE: Painted dark fantasy concept art of a boss character, with visible brushwork, rich worn metal and soft lost edges in the shadows.

EXCLUDE: text, visible face, skin, blood or gore, other characters, a ring or halo behind the head, border, and any resemblance to an existing game character.
```

---

## Tier 2: page backgrounds and portraits

### `auth-background.png`

Behind the login and register forms. It shows sharp and full-screen, with a dark veil on top (about 42% dark in the center, 80% at the corners) and a 460-pixel-wide form covering the center. A 16:9 screen crops about 8% off the top and bottom.

```text
Generate exactly one image at 1536 x 1024 pixels, 3:2 landscape, fully opaque, no transparency.

SCENE: The interior of a ruined stone chapel at night, with a small campfire burning on the cracked floor and a soft shaft of gold light falling through the broken roof.

FRAMING: The image is shown sharp and full-screen, cropped to 16:9, which removes about 8% from the top and 8% from the bottom. A login form covers the center. Place nothing important in the cropped areas or the center.

COMPOSITION:
- The center of the frame, from 34% to 66% across, stays dim and simple, because a form covers it. Do not place the fire or any bright light there.
- Campfire: on the floor at 18% across and 70% down, about 8% of the frame width.
- Greatsword: leaning against the stump of a broken pillar at 8% across, with its point on the floor at 74% down and its height about 22% of the frame. It is well away from the fire.
- Right side: broken pews and a fallen stone statue at 78% to 95% across.
- Rear wall: tall empty gothic arched windows spanning the back, with the roof half collapsed at the upper right, showing a dim night sky. The shaft of gold light comes through this gap and lands on the rubble at 84% across and 66% down.

CAMERA: Eye level, 28mm equivalent, one-point perspective toward the back wall, deep focus.

LIGHTING: Warm firelight in ember #E08A3A with a reach of about 25% of the frame width, falling off quickly into darkness. Pale gold moonlight in bright gold #ECD59B through the arched windows and roof gap, scattering as deep gold #7D5F2B in the fog. About 75% of the frame is in shadow, with shadows down to #0A0908. The site darkens this image further, so the fire and the shaft of light should reach pale gold #F6ECD2 at their hottest points.

ATMOSPHERE: Thin smoke rising from the fire, ash and fine gold dust motes drifting through the moonlight, a few ember sparks near the fire.

STYLE: Painted dark fantasy concept art with visible brushwork, luminous gold light and soft lost edges in the shadows.

EXCLUDE: text, people, religious symbols, stained-glass imagery, a sword stuck in or beside the fire, any ring or halo of light, bright colors other than gold, border.
```

### `lost.png`

The "page not found" screen, shown about 220 x 330 pixels.

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SCENE: A desolate empty road vanishing into thick fog lit by a faint, distant gold light.

COMPOSITION: A narrow dirt road starts at the bottom center and disappears into fog at 50% across and 52% down. A single dead leafless tree stands at 72% across, its base at 58% down, leaning left. One leaning wooden grave cross stands at the road's edge at 30% across and 70% down. The top half is only flat fog with no visible horizon.

CAMERA: Eye level, 35mm equivalent, deep focus.

LIGHTING: Soft and almost sourceless. Fog runs from deep gold #7D5F2B at its brightest, around the vanishing point, down to surface #181510 at the frame's edges. Objects are near-black #0A0908. Nearly monochrome, and dimmer than any other image in the set.

ATMOSPHERE: Slow drifting ash and a sparse scatter of about 30 fine gold dust motes near the vanishing point.

STYLE: Painted dark fantasy concept art with visible brushwork and soft lost edges dissolving into fog.

EXCLUDE: text, people, animals, signs, ember or red tones, a golden tree, any ring of light, border.
```

### `avatar-default.png`

The portrait for players who have not uploaded one. Shown from 32 x 32 up to 168 x 168 pixels, cropped to a circle.

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, fully opaque, no transparency.

SUBJECT: A head-and-shoulders portrait of an anonymous hooded wanderer, seen straight-on.

COMPOSITION: Centered and symmetrical, designed to survive being cropped to a circle touching all four edges. The hood's top sits 12% from the top of the image, and the shoulders run off the bottom edge. The face opening is centered at 46% down, with width about 28% of the image. It is entirely black, with two tiny ember #E08A3A glints for eyes.

DETAIL: A heavy worn cloak and hood of dark rough wool in surface #181510, with folds as simple bold painted shapes. A small gold #C9A45C clasp at the throat, and a thin gold line along the hood's edge.

CAMERA: Eye level, 85mm portrait equivalent, frontal, deep focus.

LIGHTING: Thin rim light in bright gold #ECD59B from behind and above on the hood's edge, and a faint deep gold #7D5F2B glow from below on the clasp. The background is flat near-black #0A0908 with a very faint gold vignette behind the head.

STYLE: A painted dark fantasy character portrait with visible brushwork. Must read clearly at 32 pixels: strong silhouette, minimal detail.

EXCLUDE: text, visible facial features, weapons, a ring or halo behind the head, border.
```

### Class portraits

Four full-body characters in one consistent style, using the class names from the game. Generate them in this order in the same conversation, so they match. The Mage's id in the code is still `arcanist`, so its file is `class-arcanist.png`.

These paint each class at its most imposing, not the exact in-game model. The game's free outfit tier has no plate armor or robes, so the Juggernaut's plate and the Mage's long robes go beyond what the 3D characters wear today.

### `class-juggernaut.png`

Juggernaut, heavy axe or hammer: "Slow, tough and hits very hard. Big swings can knock a group of enemies off balance."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SUBJECT: An original full-body character called the Juggernaut: a huge, slow, heavily armored warrior carrying one massive two-handed battle axe. The figure feels immovable.

COMPOSITION: Full body, standing, centered and turned slightly toward the viewer's left. The top of the helm sits 8% from the top of the frame and the feet stand at 92% down, so the figure is about 84% of the frame height. The shoulders span about 54% of the frame width. The axe is held upright at the figure's side, its head at about 14% down and its haft resting on the ground at 92% down. Figure and axe stay at least 6% inside the left and right edges.

CHARACTER DESIGN:
- Head: a closed angular great helm with one narrow dark eye slit. No visible face.
- Armor: thick layered plate in surface #181510 with worn edges, massive rounded pauldrons, and a thin gold #C9A45C trim line along each plate edge. A short tattered tabard in blood #8A2F2F hangs at the waist.
- Weapon: a single crescent axe blade about 26% of the frame width, dark steel #181510 with a bright gold #ECD59B cutting edge and one thin gold inlay line. The haft is wrapped in deep gold #7D5F2B leather.

BACKGROUND: Flat near-black #0A0908 with soft surface #181510 fog behind the figure, and a faint deep gold #7D5F2B glow on the ground under the feet. No scenery.

CAMERA: Eye level at chest height, 50mm equivalent, level, deep focus.

LIGHTING: Two narrow rim lights from behind at the upper left and upper right draw a thin bright gold #ECD59B outline around the whole figure, reaching pale gold #F6ECD2 at the brightest points. The front stays in shadow, with a faint deep gold #7D5F2B fill from below. About 70% of the figure is in shadow.

ATMOSPHERE: About 60 fine bright gold dust motes around the figure, thin low fog at the ankles, a few flakes of ash.

STYLE: Painted dark fantasy concept art of one character, with visible brushwork, rich worn materials and soft lost edges in the shadows. The same style, framing and lighting as every other class portrait in this set.

EXCLUDE: text, visible face, other characters, scenery, any weapon other than the one axe, shield, a ring or halo behind the figure, gore, border, and any resemblance to an existing game character.
```

### `class-duelist.png`

Duelist, sword or katana: "Fast, precise close-range fighter. Chains quick attacks and dodges."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SUBJECT: An original full-body character called the Duelist: a lean, fast, lightly armored swordfighter holding one long slender single-edged curved sword with katana proportions. The figure feels poised and ready to move.

COMPOSITION: Full body, standing in a low balanced stance, centered and turned slightly toward the viewer's right. The top of the hood sits 8% from the top of the frame and the feet stand at 92% down, so the figure is about 84% of the frame height. The shoulders span about 30% of the frame width. The sword is held low in one hand, angled down and outward, with its point at about 80% across and 76% down, and an empty scabbard at the opposite hip. Figure and sword stay at least 6% inside the left and right edges.

CHARACTER DESIGN:
- Head: a close-fitted hood and a plain dark half-mask, with the eyes lost in shadow. No visible face.
- Armor: light overlapping plates and fitted leather in surface #181510, with a thin gold #C9A45C trim line along each edge. A long tattered sash in blood #8A2F2F trails from the waist.
- Weapon: a dark steel #181510 blade with a bright gold #ECD59B edge along its full length, a small plain gold #C9A45C guard, and a grip wrapped in deep gold #7D5F2B cord.

BACKGROUND: Flat near-black #0A0908 with soft surface #181510 fog behind the figure, and a faint deep gold #7D5F2B glow on the ground under the feet. No scenery.

CAMERA: Eye level at chest height, 50mm equivalent, level, deep focus.

LIGHTING: Two narrow rim lights from behind at the upper left and upper right draw a thin bright gold #ECD59B outline around the whole figure, reaching pale gold #F6ECD2 at the brightest points. The front stays in shadow, with a faint deep gold #7D5F2B fill from below. About 70% of the figure is in shadow.

ATMOSPHERE: About 60 fine bright gold dust motes around the figure, thin low fog at the ankles, a few flakes of ash.

STYLE: Painted dark fantasy concept art of one character, with visible brushwork, rich worn materials and soft lost edges in the shadows. The same style, framing and lighting as every other class portrait in this set.

EXCLUDE: text, visible face, other characters, scenery, any weapon other than the one sword, shield, a ring or halo behind the figure, gore, border, anime styling, and any resemblance to an existing game character.
```

### `class-arcanist.png`

Mage, staff and spells: "Deals huge magic damage from far away, but dies quickly if enemies reach it."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SUBJECT: An original full-body character called the Mage: a thin robed spellcaster holding one tall staff, with a small sphere of gold light floating at its top. The figure feels frail, learned and dangerous.

COMPOSITION: Full body, standing upright, centered and turned slightly toward the viewer's left. The top of the hood sits 12% from the top of the frame and the feet stand at 92% down, so the figure is about 80% of the frame height. The shoulders span about 26% of the frame width. The staff is held in one hand, planted on the ground at 92% down and rising to 6% from the top of the frame at about 68% across. The other hand is raised and open at chest height, with a few gold motes around the fingers. Figure and staff stay at least 6% inside the left and right edges.

CHARACTER DESIGN:
- Head: a deep hood with the face fully lost in shadow. No visible face.
- Robe: long layered robes in surface #181510 falling to the floor, with thin plain gold #C9A45C lines along the hems and no symbols. A sparing strip of blood #8A2F2F lining shows at the collar.
- Weapon: a staff of blackened wood #181510 wrapped by one thin gold #C9A45C spiral line. Its top ends in three thin open gold prongs, not a loop or ring, holding a floating sphere of pale gold #F6ECD2 light about 5% of the frame width, with a few ember #E08A3A sparks.

BACKGROUND: Flat near-black #0A0908 with soft surface #181510 fog behind the figure, and a faint deep gold #7D5F2B glow on the ground under the feet. No scenery.

CAMERA: Eye level at chest height, 50mm equivalent, level, deep focus.

LIGHTING: Two narrow rim lights from behind at the upper left and upper right draw a thin bright gold #ECD59B outline around the whole figure, reaching pale gold #F6ECD2 at the brightest points. The sphere on the staff adds a small soft pool of gold light on the nearest shoulder. The front stays in shadow, with a faint deep gold #7D5F2B fill from below. About 70% of the figure is in shadow.

ATMOSPHERE: About 60 fine bright gold dust motes around the figure, thin low fog at the ankles, a few flakes of ash.

STYLE: Painted dark fantasy concept art of one character, with visible brushwork, rich worn materials and soft lost edges in the shadows. The same style, framing and lighting as every other class portrait in this set.

EXCLUDE: text, runes or symbols, visible face, beard, wizard hat, other characters, scenery, any weapon other than the one staff, a ring or halo behind the figure or on the staff, gore, border, and any resemblance to an existing game character.
```

### `class-ranger.png`

Ranger, bow: "Fights from a distance and keeps moving. The fastest class in the game."

```text
Generate exactly one image at 1024 x 1536 pixels, 2:3 portrait, fully opaque, no transparency.

SUBJECT: An original full-body character called the Ranger: a lean, quick hooded archer in a worn cloak and leather armor, holding one tall longbow. The figure feels light on its feet, about to move.

COMPOSITION: Full body, standing with a slight forward lean, centered and turned slightly toward the viewer's right. The top of the hood sits 8% from the top of the frame and the feet stand at 92% down, so the figure is about 84% of the frame height. The shoulders span about 28% of the frame width. The longbow is held upright in one hand at about 30% across, spanning from 14% to 84% down, with one arrow nocked and pointing at the ground. A quiver of arrows shows over the opposite shoulder. Figure and bow stay at least 6% inside the left and right edges.

CHARACTER DESIGN:
- Head: a deep hood and a plain cloth wrap across the lower face, with the eyes lost in shadow. No visible face.
- Armor: fitted leather in deep gold #7D5F2B and surface #181510, with a thin gold #C9A45C trim line along each edge. A long tattered cloak in surface #181510 falls behind.
- Weapon: a tall curved longbow of blackened wood #181510 with thin gold #C9A45C inlay at the grip and tips, and a pale gold #F6ECD2 string. Arrows have fletching in blood #8A2F2F.

BACKGROUND: Flat near-black #0A0908 with soft surface #181510 fog behind the figure, and a faint deep gold #7D5F2B glow on the ground under the feet. No scenery.

CAMERA: Eye level at chest height, 50mm equivalent, level, deep focus.

LIGHTING: Two narrow rim lights from behind at the upper left and upper right draw a thin bright gold #ECD59B outline around the whole figure, reaching pale gold #F6ECD2 at the brightest points. The front stays in shadow, with a faint deep gold #7D5F2B fill from below. About 70% of the figure is in shadow.

ATMOSPHERE: About 60 fine bright gold dust motes around the figure, thin low fog at the ankles, a few flakes of ash.

STYLE: Painted dark fantasy concept art of one character, with visible brushwork, rich worn materials and soft lost edges in the shadows. The same style, framing and lighting as every other class portrait in this set.

EXCLUDE: text, visible face, other characters, scenery, any weapon other than the one bow and its arrows, shield, a ring or halo behind the figure, gore, border, and any resemblance to an existing game character.
```

---

## Tier 3: UI kit

### `ui-panel-frame.png`

A frame around every panel on the site. It gets split into corners and edges and stretched to any size, so its edges must be straight and even.

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, as a PNG with a real alpha-transparent background. Fully transparent in the center and outside the frame.

OVERRIDE: This is a UI element, so the style lock's rule against frames and UI does not apply to it.

SUBJECT: A square ornamental UI frame for a dark fantasy game menu, with four identical corners.

LAYOUT: Perfectly straight-on, zero perspective. Symmetrical left-right and top-bottom. The outer edge of the frame sits 3% from each image edge. Each decorated corner is confined to a 128 x 128 pixel box at its corner, the edges between corners are completely plain and uniform along their length, and the band is about 18 pixels thick: a 4-pixel bright outer line, a 12-pixel dark channel and a 2-pixel inner line. The center, inset about 60 pixels from each edge, is fully transparent.

MATERIAL: Bright gold #ECD59B outer line, surface #181510 channel, gold #C9A45C inner line, with deep gold #7D5F2B in the recesses. The corners have thin, restrained gold filigree with a small diamond at each, elegant and not overly floral.

CAMERA: Straight-on, zero perspective.

LIGHTING: Soft and even from above, with thin pale gold #F6ECD2 highlights on the upper edges and no cast shadow.

STYLE: Finely painted aged gold metalwork, slightly worn.

EXCLUDE: text, background, drop shadow, fog, dust, anything in the center, and any ornament along the middle of the edges.
```

### `ui-button.png`

Main call-to-action buttons, with the label printed in near-black over a gold face. The ends stay fixed and the middle stretches.

```text
Generate exactly one image at 1536 x 1024 pixels, 3:2 landscape, as a PNG with a real alpha-transparent background. Fully transparent outside the button.

OVERRIDE: This is a UI element, so the style lock's rule against frames and UI does not apply to it.

SUBJECT: One wide horizontal game menu button plate, blank, seen straight-on.

LAYOUT: Centered in the image, spanning 92% of the width (about 1410 pixels) and 15% of the height (about 150 pixels). Left and right ends are exact mirror images, each with angled chamfered corners and a small diamond end cap, confined to the outer 120 pixels on each side. The section between the ends is completely uniform along its length.

MATERIAL: A polished aged gold face running from bright gold #ECD59B at the top, through gold #C9A45C in the middle, to deep gold #7D5F2B at the very bottom, smooth enough for near-black lettering to stay readable when placed over it later. A thin pale gold #F6ECD2 line along the top inner edge, and a thin deep gold #7D5F2B border around the whole shape.

CAMERA: Straight-on, zero perspective.

LIGHTING: Soft and even from above, with no cast shadow.

STYLE: Finely painted aged gold metalwork, slightly worn at the edges, with a clean uniform center.

EXCLUDE: text, icons, background, drop shadow, fog, dust, ember or red tones, scratches across the middle section.
```

### `ui-divider.png`

Section divider, shown up to about 560 x 16 pixels.

```text
Generate exactly one image at 1536 x 1024 pixels, 3:2 landscape, as a PNG with a real alpha-transparent background. Fully transparent everywhere except the divider.

SUBJECT: A long thin horizontal ornamental divider, seen straight-on.

LAYOUT: Perfectly left-right symmetrical, centered in the image, spanning 88% of the width. Total height is about 6% of the image height. At the center is a small hollow diamond containing a smaller solid diamond, with short thin flourishes on each side. From there, a single fine line extends outward and tapers to nothing at both ends.

MATERIAL: Diamonds and flourishes in bright gold #ECD59B with a pale gold #F6ECD2 highlight. The line runs from gold #C9A45C near the center to deep gold #7D5F2B at its tips. Very slight bevel and wear.

CAMERA: Straight-on, zero perspective.

LIGHTING: Soft and even, with no cast shadow.

STYLE: Thin, elegant, finely painted aged gold ornament.

EXCLUDE: text, background, drop shadow, fog, dust, circles or rings, other ornaments.
```

### `ui-portrait-ring.png`

A ring around player portraits, shown 32 to 168 pixels.

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, as a PNG with a real alpha-transparent background. Fully transparent in the center and outside the ring.

OVERRIDE: This is a plain round picture frame for a player portrait, not a sigil or logo, so the style lock's rules against ring shapes and frames do not apply to it.

SUBJECT: A perfectly circular portrait frame, seen straight-on with no perspective.

LAYOUT: Centered. The ring's outer diameter is 94% of the image, and the band is 8% of the image wide. The center hole is an exact circle and fully transparent. The ring is rotationally even, with four very small thorn-like details at top, bottom, left and right, and no other ornament.

MATERIAL: Gold #C9A45C outer lip with a thin bright gold #ECD59B highlight, surface #181510 center band, and a thin deep gold #7D5F2B inner lip. Slightly worn.

CAMERA: Straight-on, zero perspective.

LIGHTING: Soft and even from above, with no cast shadow.

STYLE: Finely painted aged gold metalwork, plain and restrained, with no symbols.

EXCLUDE: text, runes, engraved symbols, a portrait in the center, background, drop shadow, fog, dust.
```

### `ui-bar-frame.png`

Frame for health, magic and stamina bars.

```text
Generate exactly one image at 1536 x 1024 pixels, 3:2 landscape, as a PNG with a real alpha-transparent background. Fully transparent inside the slot and outside the frame.

OVERRIDE: This is a UI element, so the style lock's rule against frames and UI does not apply to it.

SUBJECT: A long, thin horizontal status bar frame, empty, seen straight-on.

LAYOUT: Centered in the image, spanning 94% of the width and 5% of the height (about 50 pixels). A rectangular slot runs the whole length, fully transparent inside. Small decorated end caps, confined to the outer 70 pixels on each side, are exact mirror images. The section between them is plain and uniform along its length.

MATERIAL: Surface #181510 body with a thin gold #C9A45C line along the top and bottom edges. End caps in gold #C9A45C with bright gold #ECD59B highlights and deep gold #7D5F2B recesses.

CAMERA: Straight-on, zero perspective.

LIGHTING: Soft and even from above, with no cast shadow.

STYLE: Finely painted aged gold and blackened iron, thin and elegant.

EXCLUDE: text, a filled bar, background, drop shadow, fog, dust.
```

### `texture-stone.png`

A subtle background texture repeated behind panels. It should barely show.

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, fully opaque, no transparency.

SUBJECT: A seamless, tileable texture of very dark worn stone with the faintest trace of old gold. The left and right edges must match perfectly, and so must the top and bottom.

DETAIL: Fine mottled grain with sparse hairline cracks and small chips, evenly distributed with no focal point and no large features. Base color is surface #181510, with variation only down to near-black #0A0908. A few of the hairline cracks hold a thin trace of deep gold #7D5F2B, and sparse tiny flecks of gold #C9A45C cover less than 1% of the area. Very low contrast, so text placed over it stays easy to read.

CAMERA: Perfectly top-down, flat, no perspective.

LIGHTING: Flat and even, with no vignette, no shadow, no highlight.

STYLE: A finely painted stone surface with a subtle hand-painted grain.

EXCLUDE: text, seams, bricks, patterns, symbols, rings, large gold veins, fog, dust motes, border.
```

---

## Tier 3: icons

All are 1024 x 1024 with real transparency, and are shown as small as 36 to 64 pixels, so bold shapes matter more than detail.

### `icon-flask.png`

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, as a PNG with a real alpha-transparent background. Every pixel outside the object must be fully transparent.

SUBJECT: A game inventory icon of one small round glass healing flask, standing upright, seen straight-on.

LAYOUT: Centered, filling 80% of the image height. Round body with a short narrow neck and a rough cork, with a worn leather strap tied around the neck.

COLOR AND MATERIAL: Thick dark glass, two-thirds filled with glowing blood-red liquid, blood #8A2F2F at the edges and a lighter red #C04A46 at the center (this one lighter red is allowed here only). A small highlight on the glass in pale gold #F6ECD2. A thin gold #C9A45C collar at the neck. Cork and strap in deep gold #7D5F2B.

CAMERA: Straight-on, no perspective.

LIGHTING: Soft bright gold #ECD59B light from the upper left, with no cast shadow.

STYLE: A bold, simple, painted dark fantasy inventory icon with a strong silhouette that reads at 54 pixels.

EXCLUDE: text, background, drop shadow, ground, fog, dust, other objects.
```

### `icon-sword.png`

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, as a PNG with a real alpha-transparent background. Every pixel outside the object must be fully transparent.

SUBJECT: A game inventory icon of one battered straight longsword, shown diagonally with the hilt at lower left and the point at upper right.

LAYOUT: Centered, spanning 88% of the image along the diagonal.

COLOR AND MATERIAL: A notched dark steel blade in surface #181510, with a bright gold #ECD59B edge highlight along one side and pale gold #F6ECD2 at the point. A gold #C9A45C crossguard and pommel, and a grip wrapped in deep gold #7D5F2B leather.

CAMERA: Straight-on, flat, no perspective.

LIGHTING: Soft bright gold #ECD59B light from the upper left, with no cast shadow.

STYLE: A bold, simple, painted dark fantasy inventory icon with a strong silhouette that reads at 46 pixels.

EXCLUDE: text, background, drop shadow, fog, dust, other objects.
```

### `icon-spell.png`

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, as a PNG with a real alpha-transparent background. Every pixel outside the object must be fully transparent.

SUBJECT: A game inventory icon of a small sphere of gold fire floating above an open skeletal iron gauntlet, seen from the front.

LAYOUT: Centered and filling 84% of the image height. The fire sphere is in the upper half, with a diameter of 36% of the image. The gauntlet is in the lower half, palm up, fingers curled.

COLOR AND MATERIAL: Fire in gold #C9A45C at its outer edge, bright gold #ECD59B through the body and a pale gold #F6ECD2 core, with a few ember #E08A3A sparks. Gauntlet in surface #181510 with gold #C9A45C knuckle details.

CAMERA: Straight-on, no perspective.

LIGHTING: Lit by the fire itself from above, with bright gold #ECD59B highlights on the fingertips and no cast shadow.

STYLE: A bold, simple, painted dark fantasy inventory icon with a strong silhouette that reads at 46 pixels.

EXCLUDE: text, a ring around the sphere, background, drop shadow, fog, other objects.
```

### `binary-dust.png`

The icon for Binary Dust, the currency players earn from kills, shown small next to their total. This is the one place besides the logo where text glyphs are intended, and the prompt overrides the no-text rule on purpose. Check that it only contains the digits 1 and 0.

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, as a PNG with a real alpha-transparent background. Every pixel outside the digits, their glow and the particles must be fully transparent, with no painted checkerboard and no dark box behind the glow.

OVERRIDE: In this image the digits are intended. The style lock's rule against text, letters and numbers does not apply to the digits 1 and 0, which are the only glyphs allowed. The style lock's gold palette and its no-glow, no-particles rule for transparent images also do not apply here: this image is red and includes its own glow and particles.

SUBJECT: A game currency icon called Binary Dust: a small loose cloud of glowing red 1 and 0 digits with faint red particles.

LAYOUT: The cloud is centered, roughly round but slightly irregular, with digits filling about 70% of the image width and height. About 14 digits, in a random mix with about equal numbers of 1 and 0: 5 large digits near the center at about 16% of the image height, 5 medium at about 10%, and 4 small toward the edge at about 6%. No two digits overlap, and each stays readable. Digits are upright or tilted at most 15 degrees, loosely scattered, with no straight rows, columns or grid. About 60 faint particles, each 2 to 6 pixels across, scatter among the digits and thin out toward 90% of the image width.

GLYPHS: Simple bold monospaced digits. Each 1 has a small flag and a flat base. Each 0 is a plain oval with nothing inside it, no slash and no dot.

COLOR: Digit bodies in red #FF3B30, with a hotter center #FF8A7A along each stroke. A soft red #FF3B30 glow around each digit fades to fully transparent within about 2% of the image width. Particles in red #FF3B30 at about 15% to 40% opacity.

CAMERA: Straight-on, flat, no perspective.

LIGHTING: The digits are the only light source. No light falls on anything else.

STYLE: Glowing painted digits with soft edges, like hot dust hanging in the air. Must read as a cluster of red digits at 32 pixels.

EXCLUDE: letters, words, any digit other than 1 and 0, gold, orange, black background, checkerboard, drop shadow, coin, pouch, a ring or circle around the cloud, falling columns of code, screens, border.
```

### Achievement medallions

Use this template for all seven, replacing `[EMBLEM]` with the matching line from the table below. Generate each separately so they share one coin design. Reusing the same conversation keeps them consistent.

```text
Generate exactly one image at 1024 x 1024 pixels, 1:1 square, as a PNG with a real alpha-transparent background. Every pixel outside the medallion must be fully transparent.

SUBJECT: A round achievement medallion, like an ancient gold coin, seen perfectly straight-on with no perspective. It is a solid disc with a filled center, never an empty ring.

LAYOUT: Centered, with a diameter of 92% of the image. A raised rim, about 7% of the image wide, with a fine beaded line along its inner edge. Inside the rim is a dark recessed field. One raised emblem sits on the field, centered and filling about 52% of the medallion's diameter: [EMBLEM].

COLOR AND MATERIAL: Rim and emblem are gold #C9A45C with deep gold #7D5F2B in the recesses and bright gold #ECD59B to pale gold #F6ECD2 on the highest edges. The field is surface #181510. Worn and slightly chipped, like old cast metal.

CAMERA: Straight-on, zero perspective.

LIGHTING: Soft gold light from the upper left, catching the raised edges, with no cast shadow.

STYLE: A bold, simple, painted dark fantasy icon. The emblem must be readable at 62 pixels, so use a strong simple silhouette with no fine detail.

EXCLUDE: text, letters, numbers, background, drop shadow, ribbons, fog, dust.
```

| Filename | `[EMBLEM]` |
|---|---|
| `ach-welcome.png` | a single upward flame with three tongues, with a small ember #E08A3A inlay at its core |
| `ach-profile_picture.png` | a hooded mask portrait seen from the front: a deep hood framing a smooth blank mask with no facial features |
| `ach-first_blood.png` | a single large teardrop-shaped drop of blood, inlaid in blood red #8A2F2F with a thin gold edge |
| `ach-beast_hunter.png` | a deer skull seen from the front, with wide branching antlers |
| `ach-grave_walker.png` | a plain leaning grave cross planted in a small mound |
| `ach-boss_slayer.png` | a broken five-spike crown pierced vertically by a sword |
| `ach-unbroken.png` | an intact heater-shaped shield seen from the front, with one raised vertical ridge and no cracks |

---

## Notes

- **Website art only.** The gold painted look applies to the website. The 3D game itself stays PS1 low-poly.
- **Keep it original.** The prompts describe a look, not an existing game. Avoid adding names of real games or their characters, since the repo and site will both be public. If a result drifts toward a ring-shaped symbol, a giant golden tree or anything you recognize from another game, use the matching fix in the table above.
- **Text is the weak spot.** Image models misspell often, so check `logo.png` letter by letter and make sure `binary-dust.png` contains only 1s and 0s.
- **3D world art is separate.** Skies, ground textures and character models for the game are left out on purpose, because they follow the low-poly game style instead of this one.
