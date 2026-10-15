import type { OrderChanges as Changes } from "@skynot/contract";
import { useState } from "preact/hooks";
import "./views.css";

export type ReadChanges = (orderId: string) => Promise<Changes>;

const kindOf = (line: string): string =>
  line.startsWith("diff --git") ? "file" : line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : "context";

// Read on demand: a diff can be large, and most orders are opened for something else.
export function OrderChanges({ orderId, read }: { orderId: string; read: ReadChanges }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function show() {
    setReading(true);
    setProblem(null);
    try {
      setChanges(await read(orderId));
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setReading(false);
    }
  }

  if (!changes)
    return (
      <>
        <button class="secondary-button" type="button" onClick={() => void show()} disabled={reading}>
          {reading ? "Reading the changes…" : "Show the changes"}
        </button>
        {problem && (
          <p class="order-changes-problem" role="alert">
            {problem}
          </p>
        )}
      </>
    );
  if (!changes.diff.trim()) return <p class="form-note">The branch changes nothing against the base.</p>;
  return (
    <>
      <pre class="order-diff" aria-label={`Changes of ${orderId}`}>
        {changes.diff.split("\n").map((line, index) => (
          <span key={index} class={`diff-${kindOf(line)}`}>
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
      {changes.cut && <p class="form-note">Cut here: the rest is too long to read in the studio. The pull request, or a clone, has all of it.</p>}
    </>
  );
}
