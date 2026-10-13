import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const FILES: Record<string, string> = {
  "README.md": `# tasks

A small command line to-do list. Tasks are kept in \`tasks.json\`, next to where the command runs.

    tasks add "Call the plumber" --due tomorrow
    tasks list
    tasks done 3

\`list\` prints every task, oldest first, finished ones included.
`,
  "package.json": `{
  "name": "tasks",
  "version": "0.3.0",
  "type": "module",
  "bin": { "tasks": "src/cli.js" },
  "scripts": { "test": "node --test" }
}
`,
  "src/cli.js": `#!/usr/bin/env node
import { parseDate } from "./dates.js";
import { load, save } from "./store.js";

const [command, ...rest] = process.argv.slice(2);
const tasks = await load();

if (command === "add") {
  const due = rest.indexOf("--due");
  const title = (due === -1 ? rest : rest.slice(0, due)).join(" ");
  tasks.push({ id: tasks.length + 1, title, done: false, due: due === -1 ? null : parseDate(rest[due + 1]) });
  await save(tasks);
} else if (command === "done") {
  const task = tasks.find((candidate) => candidate.id === Number(rest[0]));
  if (!task) throw new Error(\`no task \${rest[0]}\`);
  task.done = true;
  await save(tasks);
} else if (command === "list") {
  for (const task of tasks) console.log(\`\${task.done ? "[x]" : "[ ]"} \${task.id} \${task.title}\${task.due ? \` (due \${task.due})\` : ""}\`);
} else {
  console.error("usage: tasks add <title> [--due <date>] | list | done <id>");
  process.exitCode = 1;
}
`,
  "src/dates.js": `const DAY = 24 * 60 * 60 * 1000;

// Accepts "today", "tomorrow" or YYYY-MM-DD, and returns YYYY-MM-DD. Anything else throws.
export function parseDate(text, now = new Date()) {
  if (text === "today") return now.toISOString().slice(0, 10);
  if (text === "tomorrow") return new Date(now.getTime() + DAY).toISOString().slice(0, 10);
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))) return text;
  throw new Error(\`not a date: \${text}\`);
}
`,
  "src/store.js": `import { readFile, writeFile } from "node:fs/promises";

const FILE = "tasks.json";

export async function load() {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function save(tasks) {
  await writeFile(FILE, JSON.stringify(tasks, null, 2));
}
`,
  "test/dates.test.js": `import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate } from "../src/dates.js";

test("tomorrow is the day after now", () => {
  assert.equal(parseDate("tomorrow", new Date("2026-03-01T10:00:00Z")), "2026-03-02");
});

test("a word that is not a date is refused", () => {
  assert.throws(() => parseDate("someday"));
});
`,
};

export async function writeSeededRepo(dir: string): Promise<void> {
  for (const [file, content] of Object.entries(FILES)) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), content);
  }
}
