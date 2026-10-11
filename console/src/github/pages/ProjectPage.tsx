import { pageHref, type PublicPage } from "../links";
import {
  Arrow,
  Eyebrow,
  SectionTitle,
  Principles,
  workflow,
} from "../components";
import { StudioPreview } from "../StudioPreview";

export function ProjectPage({ page }: { page: PublicPage }) {
  return (
    <>
      <section class="gh-project-hero">
        <div class="gh-hero-copy">
          <Eyebrow>A DEV SHOP OF AI AGENTS · IN DEVELOPMENT</Eyebrow>
          <h1>
            Your judgment.
            <br />
            <em>
              A team
              <br />
              of agents.
            </em>
          </h1>
          <p>
            From context to a pull request. Skynot runs a team per project
            that builds software under human direction, in isolated worktrees,
            with deliveries you can review.
          </p>
          <div class="gh-actions">
            <a class="gh-button" href="#how">
              See the flow <Arrow />
            </a>
            <a class="gh-text-link" href={pageHref(page, "app")}>
              The GitHub connection <Arrow />
            </a>
          </div>
        </div>
        <StudioPreview />
      </section>
      <div class="gh-caption-strip">
        <span>HUMAN-DIRECTED SOFTWARE</span>
        <span>
          Node.js <i>·</i> DDD <i>·</i> Events <i>·</i> Ports and adapters
        </span>
      </div>
      <section class="gh-section" id="how">
        <SectionTitle
          label="FROM CONTEXT TO DELIVERY"
          title="An idea needs a process."
        >
          The Manager coordinates. The agents build. The decisions stay with
          you.
        </SectionTitle>
        <ol class="gh-workflow">
          {workflow.map(([title, text], i) => (
            <li>
              <span class="gh-step">{String(i + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section class="gh-section">
        <SectionTitle
          label="THE FOUNDATIONS"
          title="Autonomy with clear rules."
        />
        <Principles />
      </section>
      <section class="gh-feature-grid">
        <article>
          <span class="gh-symbol">⌂</span>
          <h3>Every project, its own studio</h3>
          <p>
            Its own repository, context and team. One conversation with the
            Manager, and the questions that wait for your answer.
          </p>
        </article>
        <article>
          <span class="gh-symbol">◎</span>
          <h3>Work leaves a trail</h3>
          <p>
            Orders, activity and costs per project. Costs are what each engine
            reports for its runs.
          </p>
        </article>
        <article>
          <span class="gh-symbol">↗</span>
          <h3>GitHub as the meeting point</h3>
          <p>
            Labeled issues become proposed orders. Branches and pull requests
            make the work visible. The next step is yours.
          </p>
        </article>
      </section>
      <section class="gh-endcard">
        <div>
          <Eyebrow>MADE AT SKYNOT LABS</Eyebrow>
          <h2>
            One lab.
            <br />
            <em>Many possibilities.</em>
          </h2>
        </div>
        <a class="gh-button" href={pageHref(page, "organization")}>
          Meet the lab <Arrow />
        </a>
      </section>
    </>
  );
}
