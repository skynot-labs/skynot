export type Inline = { kind: "text" | "code" | "bold"; value: string } | { kind: "link"; value: string; href: string };
export type Block =
  | { kind: "paragraph" | "heading"; content: Inline[] }
  | { kind: "bullets" | "steps"; items: Inline[][] }
  | { kind: "code"; value: string };

// Only what agents actually write: code, bold and links to the web. An asterisk alone is left as text, since paths and globs carry them.
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const STEP = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push({ kind: "text", value: text.slice(last, match.index) });
    const [, code, bold, label, href] = match;
    if (code !== undefined) parts.push({ kind: "code", value: code });
    else if (bold !== undefined) parts.push({ kind: "bold", value: bold });
    else parts.push({ kind: "link", value: label!, href: href! });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  const closeParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", content: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (FENCE.test(line)) {
      closeParagraph();
      const end = lines.findIndex((candidate, position) => position > index && FENCE.test(candidate));
      const last = end === -1 ? lines.length : end;
      blocks.push({ kind: "code", value: lines.slice(index + 1, last).join("\n") });
      index = last;
      continue;
    }
    const heading = HEADING.exec(line);
    const item = BULLET.exec(line) ?? STEP.exec(line);
    if (!line.trim()) closeParagraph();
    else if (heading) {
      closeParagraph();
      blocks.push({ kind: "heading", content: parseInline(heading[1]!) });
    } else if (item) {
      closeParagraph();
      const kind = BULLET.test(line) ? "bullets" : "steps";
      const open = blocks.at(-1);
      if (open?.kind === kind) open.items.push(parseInline(item[1]!));
      else blocks.push({ kind, items: [parseInline(item[1]!)] });
    } else paragraph.push(line.trim());
  }
  closeParagraph();
  return blocks;
}
