import { useState } from "preact/hooks";
import type { Agent, Avatar } from "../contracts";
import {
  avatarChoices,
  avatarLimits,
  resolveAvatar,
  type ResolvedAvatar,
} from "../avatars/model";
import { config } from "../config";
import { AvatarCanvas } from "./AvatarCanvas";
import { Icon } from "./Icon";

import {
  wardrobeLooks,
  applyWardrobeLook,
  ambientAvatar,
  type WardrobeLookId,
} from "../studio/wardrobe";
import {
  defaultStudioPreferences,
  type StudioPreferences,
} from "../studio/model";

type EditorTab = "body" | "wardrobe" | "accessories";
type ChoiceKey = keyof typeof avatarChoices;
type ColorKey = "skin" | "hair" | "shirt" | "pants" | "shoes" | "accent";

function Choices({
  field,
  title,
  value,
  onChange,
}: {
  field: ChoiceKey;
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset class="avatar-field">
      <legend>{title}</legend>
      <div class="choice-options">
        {avatarChoices[field].map((option) => (
          <button
            type="button"
            class={`choice-button ${value === option.value ? "selected" : ""}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ColorPicker({
  field,
  title,
  value,
  onChange,
}: {
  field: ColorKey;
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const palette =
    field === "skin" || field === "hair"
      ? config.palettes[field]
      : config.wardrobePalette;
  return (
    <fieldset class="avatar-field">
      <legend>{title}</legend>
      <div class="swatches">
        {palette.map((color, i) => (
          <button
            type="button"
            class={`swatch ${value.toLowerCase() === color ? "selected" : ""}`}
            style={{ "--swatch": color }}
            aria-label={`${title} ${i + 1}`}
            aria-pressed={value.toLowerCase() === color}
            onClick={() => onChange(color)}
          />
        ))}
        <label
          class={`avatar-custom-color ${palette.includes(value.toLowerCase()) ? "" : "selected"}`}
          style={{ "--custom-color": value }}
          title={`Pick a custom ${title.toLowerCase()}`}
        >
          <span>+</span>
          <input
            type="color"
            aria-label={`Custom ${title.toLowerCase()}`}
            value={value}
            onInput={(e) => onChange(e.currentTarget.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}

export function AvatarEditor({
  agent,
  avatar,
  alias,
  onSave,
  busy,
  settings = defaultStudioPreferences,
  followStudioLook = true,
}: {
  agent: Agent;
  avatar: Avatar;
  alias: string;
  onSave: (avatar: Avatar, alias: string, followStudioLook: boolean) => void;
  settings?: StudioPreferences;
  followStudioLook?: boolean;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(() => resolveAvatar(avatar));
  const [follow, setFollow] = useState(followStudioLook);
  const preview = follow ? ambientAvatar(draft, settings) : draft;
  const [name, setName] = useState(alias);
  const [tab, setTab] = useState<EditorTab>("body");
  const update = <K extends keyof ResolvedAvatar>(
    field: K,
    value: ResolvedAvatar[K],
  ) => setDraft((previous) => ({ ...previous, [field]: value }));
  const choices = (field: ChoiceKey, title: string) => (
    <Choices
      field={field}
      title={title}
      value={draft[field]}
      onChange={(value) =>
        setDraft((previous) => ({ ...previous, [field]: value }))
      }
    />
  );
  const color = (field: ColorKey, title: string) => (
    <ColorPicker
      field={field}
      title={title}
      value={draft[field]}
      onChange={(value) => update(field, value)}
    />
  );
  return (
    <div class="avatar-editor">
      <div class="avatar-layout">
        <aside class="avatar-preview-column">
          <div class="avatar-preview-box">
            <span class="avatar-live-label">
              <span />
              PREVIEW
            </span>
            <AvatarCanvas avatar={preview} name={name || agent.name} large />
            <span class="avatar-floor" />
          </div>
          <strong class="avatar-caption">{name || agent.name}</strong>
          <span class={`engine-tag ${agent.engine}`}>
            {agent.role} · {agent.engine}
          </span>
          <div class="avatar-proportions">
            <span>
              Height <b>{Math.round(draft.height * 100)}%</b>
            </span>
            <span>
              Build <b>{Math.round(draft.build * 100)}%</b>
            </span>
          </div>
          <p class="avatar-preview-note">
            How it looks in the studio and on the team.
          </p>
        </aside>
        <div class="avatar-options">
          <label class="swatch-label" for="agentAlias">
            DISPLAY ALIAS
          </label>
          <input
            id="agentAlias"
            type="text"
            value={name}
            maxLength={24}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder={agent.name}
          />
          <div class="avatar-studio-look">
            <label>
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.currentTarget.checked)}
              />
              Follow the studio wardrobe
            </label>
            <p>
              {follow && settings.wardrobe === "ambient"
                ? "The studio dresses this agent. Its personal clothes are kept; uncheck to wear them."
                : "Keep a personal look or let it follow the team's season."}
            </p>
          </div>
          <div
            class="avatar-editor-tabs"
            role="tablist"
            aria-label="Avatar customization"
          >
            {(
              [
                { value: "body", label: "Body" },
                { value: "wardrobe", label: "Wardrobe" },
                { value: "accessories", label: "Accessories" },
              ] as const
            ).map((item) => (
              <button
                type="button"
                id={`avatar-tab-${item.value}`}
                role="tab"
                aria-selected={tab === item.value}
                aria-controls={`avatar-panel-${item.value}`}
                onClick={() => setTab(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            class="avatar-editor-panel"
            id={`avatar-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`avatar-tab-${tab}`}
          >
            {tab === "body" && (
              <>
                <div class="avatar-sliders">
                  {(["height", "build"] as const).map((field) => (
                    <div class="avatar-slider">
                      <label for={`avatar-${field}`}>
                        {field === "height" ? "Height" : "Build"}
                        <output for={`avatar-${field}`}>
                          {Math.round(draft[field] * 100)}%
                        </output>
                      </label>
                      <input
                        id={`avatar-${field}`}
                        type="range"
                        min={avatarLimits[field].min}
                        max={avatarLimits[field].max}
                        step={avatarLimits[field].step}
                        value={draft[field]}
                        aria-valuetext={`${Math.round(draft[field] * 100)} percent of the starting proportion`}
                        onInput={(e) =>
                          update(field, Number(e.currentTarget.value))
                        }
                      />
                      <div class="avatar-range-labels">
                        <span>
                          {field === "height" ? "Shorter" : "Slimmer"}
                        </span>
                        <span>
                          {field === "height" ? "Taller" : "Broader"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {color("skin", "Skin tone")}
                {color("hair", "Hair color")}
                {choices("style", "Hairstyle")}
                {choices("facialHair", "Facial hair")}
              </>
            )}
            {tab === "wardrobe" && (
              <>
                <p class="avatar-panel-note">
                  Build the look. Colors apply to the garment you pick.
                </p>
                <span class="swatch-label">QUICK LOOKS</span>
                <div class="avatar-look-presets">
                  {Object.entries(wardrobeLooks).map(([id, look]) => (
                    <button
                      key={id}
                      onClick={() => {
                        setDraft(
                          applyWardrobeLook(draft, id as WardrobeLookId),
                        );
                        setFollow(false);
                      }}
                      aria-label={`Apply the ${look.name} look`}
                    >
                      <AvatarCanvas
                        avatar={applyWardrobeLook(draft, id as WardrobeLookId)}
                        name={look.name}
                      />
                      <span>{look.name}</span>
                    </button>
                  ))}
                </div>
                {choices("outfit", "Top")}
                {color("shirt", "Top color")}
                {color("pants", "Pants")}
                {color("shoes", "Shoes")}
              </>
            )}
            {tab === "accessories" && (
              <>
                <p class="avatar-panel-note">
                  Glasses, hat, audio and neckwear can all be worn together.
                </p>
                {choices("eyewear", "Glasses")}
                {choices("headwear", "Head")}
                {choices("audio", "Audio")}
                {choices("neckwear", "Neckwear")}
                {choices("facePaint", "Face paint")}
                {color("accent", "Accessory color")}
              </>
            )}
          </div>
        </div>
      </div>
      <div class="avatar-editor-footer">
        <p class="form-note">
          Saved per agent and project, in this browser.
        </p>
        <div class="modal-actions">
          <button
            class="secondary-button"
            disabled={busy}
            onClick={() => {
              setDraft(resolveAvatar(agent.avatar));
              setFollow(true);
            }}
          >
            Reset appearance
          </button>
          <button
            class="primary-button"
            disabled={busy}
            onClick={() => onSave(draft, name, follow)}
          >
            Save avatar
            <Icon name="check" />
          </button>
        </div>
      </div>
    </div>
  );
}
