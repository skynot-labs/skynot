import { parseBlocks, parseInline, type Inline } from "./markdown";
import "./rich-text.css";

function Spans({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part) =>
        part.kind === "code" ? (
          <code>{part.value}</code>
        ) : part.kind === "bold" ? (
          <strong>{part.value}</strong>
        ) : part.kind === "link" ? (
          <a href={part.href} target="_blank" rel="noreferrer">
            {part.value}
          </a>
        ) : (
          part.value
        ),
      )}
    </>
  );
}

// One line of an agent's text, inside whatever element already holds it.
export function RichLine({ text }: { text: string }) {
  return <Spans parts={parseInline(text)} />;
}

export function RichText({ text }: { text: string }) {
  return (
    <div class="rich-text">
      {parseBlocks(text).map((block) => {
        if (block.kind === "code") return <pre>{block.value}</pre>;
        if (block.kind === "heading")
          return (
            <h4>
              <Spans parts={block.content} />
            </h4>
          );
        if (block.kind === "paragraph")
          return (
            <p>
              <Spans parts={block.content} />
            </p>
          );
        if (block.kind !== "bullets" && block.kind !== "steps") return null;
        const List = block.kind === "steps" ? "ol" : "ul";
        return (
          <List>
            {block.items.map((item) => (
              <li>
                <Spans parts={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
