import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import tokens from "./tokens.json";
import logo from "./logo.json";
import { Brand } from "./Brand";
import { paths } from "../paths";
import { Icon } from "../ui/Icon";
import { AvatarCanvas } from "../ui/AvatarCanvas";
import { defaultAvatar } from "../config";

const sections = [
  ["identity", "Identity"],
  ["logo", "Logo"],
  ["color", "Color"],
  ["type", "Type"],
  ["tokens", "Tokens"],
  ["components", "In use"],
] as const;
const palette = [
  {
    key: "mint",
    name: "Studio mint",
    use: "Actions and deliveries",
    ink: true,
  },
  {
    key: "lavender",
    name: "Agent lavender",
    use: "Agents and active work",
    ink: true,
  },
  {
    key: "peach",
    name: "Decision peach",
    use: "Questions and approval",
    ink: true,
  },
  { key: "blue", name: "Context blue", use: "Context and review", ink: true },
  { key: "canvas", name: "Canvas", use: "Console background", ink: false },
  { key: "surface", name: "Surface", use: "Panels and controls", ink: false },
  {
    key: "text",
    name: "Warm white",
    use: "Text and brand background",
    ink: true,
  },
  { key: "rose", name: "Signal rose", use: "Errors and blocks", ink: true },
] as const;
const examples = [
  {
    name: "Mara",
    role: "Manager",
    color: tokens.color.peach,
    avatar: defaultAvatar(2),
  },
  {
    name: "Noa",
    role: "Designer",
    color: tokens.color.lavender,
    avatar: defaultAvatar(0),
  },
  {
    name: "Kai",
    role: "Developer",
    color: tokens.color.mint,
    avatar: defaultAvatar(1),
  },
];
const cssExample = `.project-action {\n  background: var(--sk-action);\n  color: var(--sk-on-action);\n  padding: var(--sk-space-3) var(--sk-space-6);\n  border-radius: var(--sk-radius-sm);\n}`;
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const channel = (start: number) => {
      const v = parseInt(hex.slice(start, start + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const l1 = luminance(a),
    l2 = luminance(b);
  return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(1);
}
function SectionHeading({
  number,
  title,
  text,
}: {
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div class="ds-section-heading">
      <span class="ds-index">{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Download({
  file,
  children,
}: {
  file: string;
  children: ComponentChildren;
}) {
  return (
    <a class="ds-download" href={`${paths.brand}${file}`} download={file}>
      {children}
      <Icon name="arrow" />
    </a>
  );
}

export function DesignSystem() {
  const [notice, setNotice] = useState("");
  const [traceKey, setTraceKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    document.title = "Skynot · identity and design";
    return () => clearTimeout(timer.current);
  }, []);
  async function copy(value: string, label: string) {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice(
        "The browser blocked the copy. Select the value or download the file instead.",
      );
    }
    timer.current = setTimeout(() => setNotice(""), 5000);
  }
  return (
    <div class="design-page">
      <a class="ds-skip" href="#identity">
        Skip to content
      </a>
      <header class="ds-header">
        <a href={paths.studio} aria-label="Skynot — back to the studio">
          <Brand />
        </a>
        <span class="ds-header-label">
          IDENTITY & DESIGN <b>v{tokens.version}</b>
        </span>
        <a class="ds-back" href={paths.github}>
          <Icon name="link" />
          <span>GitHub kit</span>
        </a>
        <a class="ds-back" href={paths.studio}>
          <Icon name="arrow" />
          <span>Back to the studio</span>
        </a>
      </header>
      <main class="ds-main">
        <section id="identity" class="ds-hero">
          <div class="ds-hero-copy">
            <span class="ds-eyebrow">
              <span class="ds-live-dot" /> THE SKYNOT VISUAL SYSTEM
            </span>
            <h1>
              One studio.
              <br />
              Many <em>minds.</em>
            </h1>
            <p>
              A dev shop of agents with human judgment. A calm identity for
              directing projects, understanding the work and giving your team a
              personality.
            </p>
            <div class="ds-hero-actions">
              <a class="ds-button" href="#logo">
                Explore the brand
                <Icon name="arrow" />
              </a>
              <a class="ds-text-link" href="#tokens">
                See the tokens ↗
              </a>
            </div>
            <span class="ds-hero-note">YOU DIRECT. THE AGENTS BUILD.</span>
          </div>
          <div class="ds-brand-board">
            <div class="ds-board-meta">
              <span>01 / PRIMARY LOCKUP</span>
              <span>{logo.organization.toUpperCase()} / GITHUB</span>
            </div>
            <div class="ds-board-logo">
              <img
                src={`${paths.brand}skynot-logo.svg`}
                width="328"
                height="80"
                alt="Skynot primary logo"
              />
              <p>AN AGENT DEV SHOP</p>
            </div>
            <div class="ds-board-bottom">
              <span>
                Calm in the interface.
                <br />
                Character in the studio.
              </span>
              <div
                class="ds-palette-dots"
                aria-label="Mint, lavender, peach and blue"
              >
                {[
                  tokens.color.mint,
                  tokens.color.lavender,
                  tokens.color.peach,
                  tokens.color.blue,
                ].map((c) => (
                  <i style={{ background: c }} key={c} />
                ))}
              </div>
            </div>
          </div>
        </section>
        <nav class="ds-section-nav" aria-label="Visual identity sections">
          {sections.map(([id, label], i) => (
            <a key={id} href={`#${id}`}>
              <span>0{i + 1}</span>
              {label}
            </a>
          ))}
        </nav>

        <section class="ds-section ds-principles" aria-label="Brand principles">
          <article>
            <Icon name="context" />
            <span class="ds-label">01 / CLARITY</span>
            <h3>The work, in plain sight.</h3>
            <p>
              Projects, decisions and costs in context. Every state has a name
              as well as a color.
            </p>
          </article>
          <article>
            <Icon name="team" />
            <span class="ds-label">02 / PERSONALITY</span>
            <h3>Your team has character.</h3>
            <p>
              Expressive avatars and studios. The pixel art lives in the team;
              the interface leaves room to think.
            </p>
          </article>
          <article>
            <Icon name="cursor" />
            <span class="ds-label">03 / HUMAN JUDGMENT</span>
            <h3>The direction is yours.</h3>
            <p>
              The agents propose and ask. You set the vision, settle conflicts
              and approve the work.
            </p>
          </article>
        </section>

        <section id="logo" class="ds-section">
          <SectionHeading
            number="02"
            title="One line. One knot."
            text="A symbol you can draw without lifting your hand: it rises, makes a small loop and comes down. The knot ties intention to work; skynot signs in lowercase."
          />
          <div class="ds-logo-grid">
            <article class="ds-logo-card">
              <div class="ds-logo-stage ds-logo-dark">
                <img
                  src={`${paths.brand}skynot-logo.svg`}
                  alt="Light logo on a dark background"
                  width="328"
                  height="80"
                />
              </div>
              <div class="ds-logo-caption">
                <div>
                  <h3>Primary</h3>
                  <p>For the console and dark backgrounds.</p>
                </div>
                <Download file="skynot-logo.svg">SVG</Download>
              </div>
            </article>
            <article class="ds-logo-card">
              <div class="ds-logo-stage ds-logo-paper">
                <img
                  src={`${paths.brand}skynot-logo-ink.svg`}
                  alt="Dark logo on a light background"
                  width="328"
                  height="80"
                />
              </div>
              <div class="ds-logo-caption">
                <div>
                  <h3>On paper</h3>
                  <p>For documents and presentations.</p>
                </div>
                <Download file="skynot-logo-ink.svg">SVG</Download>
              </div>
            </article>
            <article class="ds-logo-card">
              <div class="ds-logo-stage ds-monogram-stage">
                <div class="ds-clear-space">
                  <img
                    src={`${paths.brand}skynot-mark.svg`}
                    alt="Skynot symbol in one continuous stroke with its clear space"
                    width="80"
                    height="80"
                  />
                </div>
                <span>¼ of the height on each side</span>
              </div>
              <div class="ds-logo-caption">
                <div>
                  <h3>The knot</h3>
                  <p>Favicon, icons and small spaces.</p>
                </div>
                <Download file="skynot-mark.svg">SVG</Download>
              </div>
            </article>
          </div>
          <div class="ds-trace-card">
            <div class="ds-trace-drawing">
              <img
                key={traceKey}
                src={
                  traceKey === 0
                    ? `${paths.brand}skynot-mark.svg`
                    : `${paths.brand}skynot-mark-trace.svg?replay=${traceKey}`
                }
                width="144"
                height="144"
                alt="A stroke rises, loops and comes down: the Skynot symbol"
              />
            </div>
            <div class="ds-trace-copy">
              <span class="ds-label">ONE GESTURE / A SINGLE STROKE</span>
              <h3>It fits in a notebook too.</h3>
              <p>
                A pencil and three moves: rise, loop and carry on. A simple
                symbol for a company that connects many minds.
              </p>
              <div class="ds-trace-steps">
                <span>01 · Rise</span>
                <span>02 · Loop</span>
                <span>03 · Carry on</span>
              </div>
            </div>
            <button
              class="ds-button ds-button-secondary"
              onClick={() => setTraceKey((key) => key + 1)}
            >
              <Icon name="play" />
              Replay the stroke
            </button>
          </div>
          <div class="ds-logo-rules">
            <p>
              <strong>Give it air.</strong> Keep at least ¼ of the symbol's
              height clear around it. Use the symbol from 24 px up and the full
              logo from 164 px up.
            </p>
            <p>
              <strong>Keep its shape.</strong> Scale without distorting and pick
              a background with contrast. For a single ink, use the monochrome
              variant.
            </p>
            <Download file="skynot-logo-mono.svg">Single ink</Download>
            <Download file="skynot-mark-ink.svg">Symbol in ink</Download>
          </div>
          <div class="ds-extra-assets">
            <span class="ds-label">OTHER ASSETS</span>
            <Download file="skynot-wordmark.svg">Wordmark</Download>
            <Download file="skynot-favicon.svg">Favicon</Download>
          </div>
        </section>

        <section id="color" class="ds-section">
          <SectionHeading
            number="03"
            title="A calm base. Four accents."
            text="Dark surfaces and warm text. The accents guide without competing with the studio. Click a color to copy its value."
          />
          <div class="ds-color-grid">
            {palette.map((p) => (
              <article class="ds-swatch" key={p.key}>
                <button
                  class={`ds-swatch-color ${p.ink ? "ds-ink" : ""}`}
                  style={{ background: tokens.color[p.key] }}
                  onClick={() => copy(tokens.color[p.key], p.name)}
                  aria-label={`Copy color ${p.name}: ${tokens.color[p.key]}`}
                >
                  <span>{p.name}</span>
                  <span>
                    {tokens.color[p.key].toUpperCase()}
                    <Icon name="plus" />
                  </span>
                </button>
                <div class="ds-swatch-info">
                  <code>--sk-color-{p.key}</code>
                  <p>{p.use}</p>
                </div>
              </article>
            ))}
          </div>
          <div class="ds-color-note">
            <Icon name="check" />
            <p>
              <strong>Readable contrast.</strong> Text on canvas:{" "}
              {contrast(tokens.color.text, tokens.color.canvas)}:1. Ink on mint:{" "}
              {contrast(tokens.color.ink, tokens.color.mint)}:1. States always
              carry text or an icon.
            </p>
            <span>WCAG AA · NORMAL TEXT</span>
          </div>
        </section>

        <section id="type" class="ds-section">
          <SectionHeading
            number="04"
            title="Human to read. Precise to operate."
            text="A sans for titles and conversation. A mono for code, costs and data. No font download required."
          />
          <div class="ds-type-grid">
            <article class="ds-type-card">
              <div class="ds-type-card-header">
                <span class="ds-label">INTER / SYSTEM SANS</span>
                <span>01</span>
              </div>
              <div class="ds-type-large">
                Aa<span>→</span>
              </div>
              <h3>Build with intention.</h3>
              <p>
                A clear question. An informed decision. A team that knows where
                it is going.
              </p>
              <div class="ds-type-alphabet">
                ABCDEFGHIJKLMNOPQRSTUVWXYZ
                <br />
                abcdefghijklmnopqrstuvwxyz · 0123456789
              </div>
              <code>--sk-font-sans</code>
            </article>
            <article class="ds-type-card ds-type-mono">
              <div class="ds-type-card-header">
                <span class="ds-label">SYSTEM MONO</span>
                <span>02</span>
              </div>
              <div class="ds-type-large">
                Aa<span>{"{}"}</span>
              </div>
              <h3>project.ready</h3>
              <p>
                $4.82 USD / work order
                <br />
                order.status = in_review
                <br />
                agent.status = working
              </p>
              <div class="ds-type-alphabet">
                ABCDEFGHIJKLMNOPQRSTUVWXYZ
                <br />
                abcdefghijklmnopqrstuvwxyz · 0123456789
              </div>
              <code>--sk-font-mono</code>
            </article>
          </div>
          <div class="ds-type-scale">
            {Object.entries(tokens.type).map(([key, value]) => (
              <div key={key}>
                <span style={{ fontSize: value }}>Ag</span>
                <code>{key}</code>
                <span>{value}</span>
              </div>
            ))}
          </div>
          <p class="ds-caption">
            Inter is used when installed; otherwise the system font. Mono uses
            SF Mono, Consolas or whatever fallback is available. The scale is a
            base for new views; the console keeps its compact sizes.
          </p>
        </section>

        <section id="tokens" class="ds-section">
          <SectionHeading
            number="05"
            title="One source of truth."
            text="Tokens describe visual decisions. Edit the JSON and export CSS and assets to share this identity between the console and other surfaces."
          />
          <div class="ds-token-grid">
            <article class="ds-token-card">
              <span class="ds-label">SPACING / 4 PX BASE</span>
              <div class="ds-space-list">
                {Object.entries(tokens.space).map(([key, value]) => (
                  <div key={key}>
                    <code>{key.padStart(2, "0")}</code>
                    <span style={{ width: value }} />
                    <code>{value}</code>
                  </div>
                ))}
              </div>
              <p class="ds-caption">
                From small controls to sections with room to breathe.
              </p>
            </article>
            <article class="ds-token-card">
              <span class="ds-label">SHAPE & MOTION</span>
              <div class="ds-radius-list">
                {(["sm", "md", "lg"] as const).map((key) => (
                  <div key={key}>
                    <span style={{ borderRadius: tokens.radius[key] }} />
                    <code>{key}</code>
                    <small>{tokens.radius[key]}</small>
                  </div>
                ))}
              </div>
              <div class="ds-motion">
                <span>Interactions</span>
                <code>{tokens.motion.fast}</code>
              </div>
              <p class="ds-caption">Honors the reduced-motion preference.</p>
            </article>
            <article class="ds-code-card">
              <div>
                <span class="ds-label">USE IN CSS</span>
                <button
                  onClick={() => copy(cssExample, "CSS")}
                  aria-label="Copy the CSS example"
                >
                  <Icon name="code" />
                  Copy
                </button>
              </div>
              <pre>
                <code>{cssExample}</code>
              </pre>
              <p>
                Semantic aliases express intent: <code>action</code>,{" "}
                <code>attention</code>, <code>agent</code>, <code>context</code>
                .
              </p>
            </article>
          </div>
          <div class="ds-export-bar">
            <div>
              <Icon name="tokens" />
              <div>
                <strong>Take the system with you.</strong>
                <p>CSS ready to import and JSON for your tools.</p>
              </div>
            </div>
            <div>
              <Download file="skynot.tokens.css">Download CSS</Download>
              <Download file="skynot.tokens.json">Download JSON</Download>
            </div>
          </div>
        </section>

        <section id="components" class="ds-section">
          <SectionHeading
            number="06"
            title="The system comes alive."
            text="The same identity across decisions, agents and projects. These are visual examples; your studio's data lives in the console."
          />
          <div class="ds-components-grid">
            <article class="ds-component-card">
              <span class="ds-label">ACTIONS & STATES</span>
              <div class="ds-example-actions">
                <a class="ds-button" href={paths.studio}>
                  Open the studio
                  <Icon name="arrow" />
                </a>
                <button
                  class="ds-button ds-button-secondary"
                  onClick={() => copy("var(--sk-action)", "Action token")}
                >
                  Copy token
                </button>
                <button class="ds-button" disabled>
                  Waiting
                </button>
              </div>
              <div class="ds-statuses">
                <span class="ds-status ds-status-ready">
                  <i />
                  Ready
                </span>
                <span class="ds-status ds-status-active">
                  <i />
                  Working
                </span>
                <span class="ds-status ds-status-question">
                  <i />
                  Your call
                </span>
                <span class="ds-status ds-status-error">
                  <i />
                  Blocked
                </span>
              </div>
              <p class="ds-caption">
                One primary accent per action. State is conveyed with color and
                words.
              </p>
            </article>
            <article class="ds-component-card">
              <span class="ds-label">A TEAM WITH PERSONALITY</span>
              <div class="ds-team-examples">
                {examples.map((agent) => (
                  <div key={agent.name}>
                    <div
                      class="ds-agent-stage"
                      style={{ "--agent-accent": agent.color }}
                    >
                      <AvatarCanvas avatar={agent.avatar} name={agent.name} />
                    </div>
                    <strong>{agent.name}</strong>
                    <span>{agent.role}</span>
                  </div>
                ))}
              </div>
              <a class="ds-text-link" href={paths.studio}>
                Customize avatars in the studio ↗
              </a>
            </article>
          </div>
          <div class="ds-brand-voice">
            <span class="ds-label">THE SKYNOT VOICE</span>
            <h3>“I need your call to keep going.”</h3>
            <p>
              Direct, warm and concrete. It says what is happening, why it
              matters and which decision is needed. A company of agents that
              talks like a team.
            </p>
          </div>
        </section>
        <footer class="ds-footer">
          <a href={paths.studio} aria-label="Skynot — back to the studio">
            <Brand tagline={false} />
          </a>
          <p>
            {logo.organization} · GitHub organization
            <br />
            Working identity · v{tokens.version}
          </p>
          <a class="ds-text-link" href={paths.studio}>
            Back to the studio ↗
          </a>
        </footer>
      </main>
      <div
        class={`ds-toast ${notice ? "is-visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notice}
      </div>
    </div>
  );
}
