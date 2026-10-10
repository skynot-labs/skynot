import { useEffect, useRef, useState } from "preact/hooks";
import tokens from "../design/tokens.json";
import { defaultAvatar } from "../config";
import { defaultStudioPreferences } from "../studio/model";
import { ambientAvatar } from "../studio/wardrobe";
import { Office } from "../ui/office-renderer";
import { officeLayout } from "../ui/office-layout";

const settings = [
  { label: "Kyoto", place: "kyoto", season: "spring", festival: "none" },
  { label: "Mediterranean", place: "coast", season: "summer", festival: "none" },
  {
    label: "Ciudad de México",
    place: "cdmx",
    season: "autumn",
    festival: "muertos",
  },
] as const;
const team = [
  { name: "Manager", kind: "manager", role: "manager" },
  { name: "Design", kind: "advisor", role: "designer" },
  { name: "Architecture", kind: "advisor", role: "architect" },
  { name: "Development", kind: "worker", role: "worker" },
  { name: "Review", kind: "worker", role: "reviewer" },
] as const;

export function StudioPreview() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [setting, choose] = useState<(typeof settings)[number]>(settings[0]);
  useEffect(() => {
    if (!canvas.current) return;
    const look = {
      ...defaultStudioPreferences,
      ...setting,
      wardrobe: "ambient" as const,
    };
    new Office(canvas.current).draw({
      name: "skynot",
      accent: tokens.color.mint,
      paused: false,
      pending: 0,
      settings: look,
      agents: team.map((agent, i) => ({
        ...agent,
        id: `illustration-${i}`,
        status: "idle" as const,
        avatar: ambientAvatar(defaultAvatar(i), look),
      })),
    });
  }, [setting]);
  return (
    <figure class="gh-studio">
      <div class="gh-scene-caption">
        <span class="gh-dot" /> A STUDIO FOR EVERY PROJECT{" "}
        <span>ILLUSTRATION</span>
      </div>
      <canvas
        ref={canvas}
        width={officeLayout.width}
        height={officeLayout.height}
        role="img"
        aria-label={`Illustration of a team of agents in a ${setting.label} studio`}
      />
      <figcaption>
        <div class="gh-scene-options" aria-label="Illustration setting">
          {settings.map((option) => (
            <button
              aria-pressed={option === setting}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span>Same team. Your own setting.</span>
      </figcaption>
    </figure>
  );
}
