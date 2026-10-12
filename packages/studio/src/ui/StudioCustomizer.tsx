import { useEffect, useRef, useState } from "preact/hooks";
import type { Project } from "../contracts";
import type { Appearance } from "../application/appearance";
import {
  places,
  seasons,
  festivals,
  layoutChoices,
  studioPresets,
} from "../studio/catalog";
import {
  defaultStudioPreferences,
  studioSummary,
  type StudioPreferences,
} from "../studio/model";
import { studioScene, studioAgentAppearance } from "../studio/presentation";
import { getStudioLayout, officeLayout } from "./office-layout";
import { Office } from "./office-renderer";
import { Icon } from "./Icon";
import { AvatarCanvas } from "./AvatarCanvas";

export function StudioCustomizer({
  project,
  appearance,
  settings,
  busy,
  onSave,
}: {
  project: Project;
  appearance: Appearance;
  settings: StudioPreferences;
  busy: boolean;
  onSave: (value: StudioPreferences) => void;
}) {
  const [draft, setDraft] = useState({ ...settings });
  const canvas = useRef<HTMLCanvasElement>(null);
  const update = <K extends keyof StudioPreferences>(
    key: K,
    value: StudioPreferences[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  useEffect(() => {
    if (canvas.current)
      new Office(canvas.current).draw(
        studioScene(project, appearance, draft),
        0,
      );
  }, [project, appearance, draft]);
  return (
    <div class="studio-editor">
      <div class="studio-presets-heading">
        <span>A STARTING POINT</span>
        <p>Pick a style and make it yours.</p>
      </div>
      <div class="studio-presets">
        {studioPresets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => setDraft({ ...preset.settings })}
          >
            <Icon name={preset.icon} />
            <span>
              <strong>{preset.name}</strong>
              <small>{preset.description}</small>
            </span>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
      <div class="studio-editor-grid">
        <div class="studio-scene-controls">
          <fieldset class="studio-control-group">
            <legend>01 / PLACE</legend>
            <div class="studio-place-options">
              {Object.entries(places).map(([id, place]) => (
                <button
                  key={id}
                  class={draft.place === id ? "selected" : ""}
                  aria-pressed={draft.place === id}
                  onClick={() =>
                    update("place", id as StudioPreferences["place"])
                  }
                  style={{ "--place-color": place.palette.rug }}
                >
                  <Icon name={place.icon} />
                  <strong>{place.name}</strong>
                  <small>{place.subtitle}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <div class="studio-season-fields">
            <label>
              02 / SEASON
              <select
                aria-label="Studio season"
                value={draft.season}
                onChange={(e) =>
                  update(
                    "season",
                    e.currentTarget.value as StudioPreferences["season"],
                  )
                }
              >
                {Object.entries(seasons).map(([id, value]) => (
                  <option value={id} key={id}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              03 / FESTIVAL
              <select
                aria-label="Studio festival"
                value={draft.festival}
                onChange={(e) =>
                  update(
                    "festival",
                    e.currentTarget.value as StudioPreferences["festival"],
                  )
                }
              >
                {Object.entries(festivals).map(([id, value]) => (
                  <option value={id} key={id}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset class="studio-control-group">
            <legend>04 / LAYOUT</legend>
            <div class="studio-layout-options">
              {Object.entries(layoutChoices).map(([id, layout]) => (
                <button
                  key={id}
                  class={draft.layout === id ? "selected" : ""}
                  aria-pressed={draft.layout === id}
                  onClick={() =>
                    update("layout", id as StudioPreferences["layout"])
                  }
                  title={layout.description}
                >
                  <span class="studio-layout-map" aria-hidden="true">
                    {getStudioLayout(
                      id as StudioPreferences["layout"],
                    ).seats.map((seat, i) => (
                      <i
                        key={i}
                        style={{
                          left: `${(seat.u / 14) * 100}%`,
                          top: `${(seat.v / 10.4) * 100}%`,
                          background:
                            seat.zone === "manager"
                              ? "var(--peach)"
                              : seat.zone === "design"
                                ? "var(--lavender)"
                                : "var(--mint)",
                        }}
                      />
                    ))}
                  </span>
                  <strong>{layout.name}</strong>
                </button>
              ))}
            </div>
          </fieldset>
          <p class="studio-layout-description">
            {layoutChoices[draft.layout].description}.
          </p>
        </div>
        <div class="studio-editor-preview">
          <div class="studio-preview-header">
            <span class="tiny-led" />
            <span>PREVIEW · {project.name.toUpperCase()}</span>
            <Icon name={places[draft.place].icon} />
          </div>
          <div
            class="studio-preview-canvas"
            style={{ background: places[draft.place].palette.backdrop }}
          >
            <canvas
              ref={canvas}
              width={officeLayout.width}
              height={officeLayout.height}
              role="img"
              aria-label={`Studio preview: ${studioSummary(draft)}, ${layoutChoices[draft.layout].name}`}
            />
          </div>
          <div class="studio-preview-caption">
            <strong>{studioSummary(draft)}</strong>
            <span>{layoutChoices[draft.layout].name}</span>
          </div>
          <label class="studio-wardrobe-toggle">
            <input
              type="checkbox"
              checked={draft.wardrobe === "ambient"}
              onChange={(e) =>
                update(
                  "wardrobe",
                  e.currentTarget.checked ? "ambient" : "personal",
                )
              }
            />
            <span>
              <strong>Dress the team to match the studio</strong>
              <small>
                Seasonal clothes and festive accessories. Their features and
                glasses stay.
              </small>
            </span>
          </label>
          <div class="studio-preview-team">
            {project.agents.slice(0, 5).map((agent) => {
              const visual = studioAgentAppearance(
                project.id,
                agent,
                appearance,
                draft,
              );
              return (
                <div key={agent.id}>
                  <AvatarCanvas avatar={visual.avatar} name={visual.name} />
                  <span>{visual.name}</span>
                </div>
              );
            })}
          </div>
          <p class="studio-editor-note">
            Each agent can follow the studio or keep a personal look from its
            own editor.
          </p>
        </div>
      </div>
      <footer class="studio-editor-footer">
        <p>Saved for this project only, for every browser.</p>
        <div>
          <button
            class="secondary-button"
            onClick={() => setDraft({ ...defaultStudioPreferences })}
          >
            Reset studio
          </button>
          <button
            class="primary-button"
            disabled={busy}
            onClick={() => onSave(draft)}
          >
            Save style
            <Icon name="check" />
          </button>
        </div>
      </footer>
    </div>
  );
}
