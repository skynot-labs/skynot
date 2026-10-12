# Studio themes and avatar wardrobe

Studio styling is presentation data, separate from projects, runs and domain policy. It adds no backend commands and executes no agent. All scene art is procedural Canvas; there are no remote assets, calendar triggers, geolocation or new runtime dependencies.

## Use the controls

1. Start the shop with `npm run dev` and open the console.
2. Select a project, then click **Style the studio** in its studio header.
3. Start from a suggested environment or choose a location, season, celebration and layout independently. The preview uses the same renderer as the main studio.
4. Optionally enable **Dress the team to match the studio** to layer seasonal clothes on the agents.
5. Click **Save style**. Closing the window discards the preview. **Reset studio** returns the draft to the original office; save to apply the reset.
6. Switch projects or reload. Each project's choices stay separate, and the office keeps them, so another browser sees the same studio.

| Dimension     | Initial choices                                                |
| ------------- | -------------------------------------------------------------- |
| Place         | Original studio, Kyoto, Mediterranean coast, Patio in CDMX      |
| Season        | Year-round, spring, summer, autumn, winter                     |
| Festival      | None, Halloween, Christmas, Día de Muertos                     |
| Layout        | By zones, open studio, team islands                            |
| Team wardrobe | Personal or ambient                                            |

The office moves for as long as the page is open. The pause button under it, beside the shortcuts to the activity log and the team, holds it still and wakes it again; the choice is remembered in this browser, not in the service. When the system asks for less motion the office is held still whatever was chosen, and the button shows as pressed and cannot be changed.

Locations are stylized inspirations. Seasons and festivals are explicit visual choices, even when combined; nothing switches automatically by date. The selected environment is summarized in the studio footer and project list.

## Recognizable scene identity

Each place uses large silhouettes, architecture and original wall art in addition to its palette:

- **Kyoto:** exterior torii, timber/shōji lattice, red lanterns, samurai armor and original anime club art.
- **Mediterranean coast:** blue arches and striped awnings, blue/white tile patterns, sailboats and a large parasol.
- **CDMX:** yellow/pink patio walls, turquoise tile band, colorful papel picado, lucha libre mask, axolotl art and cactus.

Spring adds a large blossom tree and petals; summer adds a sun and beach accessories; autumn adds a colorful tree and fallen leaves; winter adds snow, icicles and a snowman. Halloween adds glowing pumpkins, bats, cobwebs and a ghost. Christmas adds a large decorated tree, ribbons, lights and presents. Día de Muertos replaces the coffee counter with a tiered ofrenda, candles, a calavera and vivid cempasúchil.

These are stylized, original motifs. Environment, season and celebration remain independently selectable. Surroundings sit outside desk areas; scene objects share the depth queue. Wall art changes the decorative boards, while vision/context still lives in the project's **Context** view.

## Dress one agent

Open an agent from the team roster or the **Agents** view, then choose **Wardrobe**. Eleven quick looks change clothing and accessories while preserving body proportions, skin, hair, facial hair, eyewear and audio. Each quick look switches that agent to personal wardrobe, and can be edited before saving.

**Follow the studio wardrobe** lets the agent opt into the project-wide ambient look. If active, its preview shows the composed result. Turn it off to edit and use its personal outfit. The saved base avatar and alias live in the existing project/agent appearance record; the optional `followStudioLook` flag defaults to participation when absent.

Ambient styling applies festival costumes first. Without a festival, the selected place defines the outfit (happi/kabuto, nautical stripes/straw hat, or an embroidered shirt). Seasons adjust the accent and add cold-weather scarves while keeping the regional silhouette. The original studio uses the seasonal or everyday workshop outfit. It preserves existing hats and neck accessories; newly suggested accessories fill empty slots. Optical glasses and headphones remain visible. Disable team wardrobe or opt out on an agent to restore the base outfit without losing customization. Independent headwear choices include a flower crown, Christmas hat, Halloween hat, samurai kabuto and straw hat. Garments include happi, nautical stripes, embroidery, skeleton costumes and a patterned Christmas sweater. Optional calavera face paint is a separate editor choice and is applied before eyewear/audio; it does not change the saved skin tone or facial features.

## Source boundaries

| File | Responsibility |
| --- | --- |
| `packages/studio/src/studio/catalog.ts` | Place palettes, material/window styles, season/festival decoration IDs, layout labels and suggested combinations |
| `packages/studio/src/studio/model.ts` | Validated preferences, defaults, catalog fallback and theme composition |
| `packages/studio/src/application/studio-appearance.ts` | Browser storage and project preference lookup |
| `packages/studio/src/studio/wardrobe.ts` | Wardrobe-only presets and reversible avatar composition |
| `packages/studio/src/studio/presentation.ts` | Project + preferences → scene and displayed avatars; preserves runtime state |
| `packages/studio/src/studio/scene-decor.ts` | Typed, procedural material/window/decor painters |
| `packages/studio/src/studio/scene-motifs.ts` | Large cultural wall art, architecture, surroundings and landmark props |
| `packages/studio/src/ui/office-layout.ts` | Room frame, zone/seat/partition definitions and role-aware seat placement |
| `packages/studio/src/ui/office-renderer.ts` | Shared scene renderer, depth ordering and agent/decision hit areas |
| `packages/studio/src/ui/StudioCustomizer.tsx` | Unsaved draft, live preview, choices and commit callback |
| `packages/studio/src/ui/AvatarEditor.tsx` | Personal look editor and per-agent wardrobe participation |

The same composed avatars feed the canvas, preview, roster and agents view. The editor saves the base avatar, never the temporary ambient layer. Layouts only change visual positions and partitions. They do not change agent roles, work assignments, status, permissions, approvals or costs. A zone that runs out of desks switches to tighter rows, up to fifteen desks (one Manager, nine workers, five advisors); beyond that the scene paints "+N MORE ON THE TEAM" and the full team stays in the roster.

## Extend the catalog

**New place:** add a stable key to `places` in `catalog.ts`, with a label, icon, material (`wood`, `tatami`, `tile`), existing window view (`city`, `mountains`, `sea`, `patio`), complete palette and decoration IDs. The schema and place chooser derive their choices from that catalog. There is no App switch to edit. Add a painter only if the new place needs a new geometry style.

**New decoration:** extend `DecorId` and add its painter to the typed registry in `scene-decor.ts`, then reference the ID from a place, season or festival. Declare a shared physical slot in `decorSlots` when a prop replaces an existing one. Composition prioritizes festival over season over place for occupied slots (for example, the Christmas tree replaces the coastal parasol). Large motif painters can live in `scene-motifs.ts` and join the shared registry. Background surroundings draw before walls; architectural bands before windows; object props enter the depth queue. `ScenePainter` supplies projection, blocks, polygons and lines. Use `add(depth, draw)` for furniture/props so the shared renderer sorts them with desks and agents; draw wall art before the furniture pass. Keep props away from occupied desks and interactive labels. Prefer existing primitives to new assets.

**New layout:** add a stable key and label to `layoutChoices`, then a matching entry in `studioLayouts`. Define zone bounds, role-tagged seats, the `denseSeats` a zone switches to when its team outgrows them, and partitions; keep desk extents and seated avatars inside the room. The shared placement algorithm puts Manager, workers and advisors in appropriate visual zones without duplicating an agent. Room dimensions, projection, the shared decision table and hit coordinate scaling remain common to the initial layouts.

**New look:** add a wardrobe-only patch to `wardrobeLooks`. The editor builds its look shelf from that map. For a new seasonal/festival ID, extend the ambient look resolver as well; TypeScript catches a missing mapping. Do not put body, face, identity or runtime fields in the patch. A new accessory shape needs both an enum choice in `packages/studio/src/avatars/model.ts` and a drawing/bounds update in `packages/studio/src/ui/avatar-renderer.ts`.

Unknown stored catalog IDs fall back one field at a time. Retain stable IDs when renaming labels. If replacing IDs, add a migration rather than relying on defaults. Storage write failures leave the current session usable and show a notice; they do not pretend the preference was saved.

## Persistence boundary

Preferences are kept by the office, in its event log, as `studio/<project>` and `avatar/<project>/<agent>` entries sent with the `set-preference` command; they follow the project to any browser. Choices an earlier version left in browser storage (`skynot-studios-v1`) are uploaded once and then removed. Treat visual preference changes as settings events; do not derive operational work status from the scene. Keep personal settings distinguishable from shared project defaults if multiple directors can change them.

## Validation

`npm test` covers project isolation, unknown-ID recovery, storage failure, reversible wardrobe layering, personal opt-out, unchanged project/run state and non-duplicated seats within room bounds. Use `npm run typecheck` for type checks and `npm run build:console` for the static output. Review actual scene art at desktop and mobile sizes whenever adding geometry: unit tests cannot establish whether a decoration hides a desk or label.
