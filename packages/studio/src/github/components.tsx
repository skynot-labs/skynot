import type { ComponentChildren } from "preact";

const pillars = [
  {
    number: "01",
    title: "People direct",
    text: "The Manager proposes an order with clear criteria. You decide when the work starts.",
  },
  {
    number: "02",
    title: "Code validates",
    text: "Rules, permissions and state live in the service. Every decision leaves an event in the log.",
  },
  {
    number: "03",
    title: "Delivery is reviewed",
    text: "One worktree per order, the project's own checks and a review before you decide to merge the pull request.",
  },
];
export const workflow = [
  ["Talk", "Vision, context and questions with the Manager."],
  ["Sign", "An explicit order, with scope and criteria."],
  ["Build", "The worker works in its own worktree."],
  ["Review", "Checks and a separate review."],
  ["Decide", "A pull request for you to review and merge."],
];

export function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
export function Eyebrow({ children }: { children: ComponentChildren }) {
  return (
    <p class="gh-eyebrow">
      <span class="gh-dot" />
      {children}
    </p>
  );
}
export function SectionTitle({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="gh-section-title">
      <span class="gh-eyebrow">{label}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Principles() {
  return (
    <div class="gh-principles">
      {pillars.map((item) => (
        <article>
          <span class="gh-index">{item.number}</span>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
        </article>
      ))}
    </div>
  );
}
