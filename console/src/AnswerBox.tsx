import { useState } from "preact/hooks";

export function AnswerBox({ placeholder, options = [], onAnswer }: { placeholder: string; options?: readonly string[]; onAnswer: (answer: string) => Promise<boolean> }) {
  const [text, setText] = useState("");

  return (
    <div class="question">
      {options.length > 0 && (
        <div class="choices">
          {options.map((option) => (
            <button type="button" key={option} onClick={() => onAnswer(option)}>{option}</button>
          ))}
        </div>
      )}
      <form
        class="other"
        onSubmit={async (event) => {
          event.preventDefault();
          const answer = text.trim();
          if (answer && (await onAnswer(answer))) setText("");
        }}
      >
        <input value={text} placeholder={placeholder} onInput={(event) => setText(event.currentTarget.value)} />
        <button type="submit" disabled={!text.trim()}>Answer</button>
      </form>
    </div>
  );
}
