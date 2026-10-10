import { exec, run, type Exec } from "../../kernel/process";
import type { Board, BoardStage } from "../domain";

interface Layout {
  projectId: string;
  fieldId: string;
  options: Map<string, string>;
}

interface Item {
  id: string;
  content?: { url?: string; body?: string };
}

const ITEM_LIMIT = "1000";

// A user or organization project (v2) driven through `gh project`; the Status field holds the stage.
export class GhBoard implements Board {
  private layout: Promise<Layout> | undefined;
  private readonly items = new Map<string, string>();

  constructor(
    private readonly options: { owner: string; number: number; columns: Readonly<Record<BoardStage, string>> },
    private readonly execute: Exec = exec,
  ) {}

  async place({ url, stage, title }: { url: string; stage: BoardStage; title?: string }): Promise<void> {
    const { owner, number, columns } = this.options;
    const layout = await this.load();
    const option = layout.options.get(columns[stage]);
    if (!option) throw new Error(`board ${owner}/${number} has no Status option named "${columns[stage]}"`);

    const item = await this.card(url, title);
    await this.gh(["project", "item-edit", "--id", item, "--project-id", layout.projectId, "--field-id", layout.fieldId, "--single-select-option-id", option]);
  }

  private async card(url: string, title: string | undefined): Promise<string> {
    const known = this.items.get(url) ?? (await this.find(url)) ?? (await this.add(url, title));
    this.items.set(url, known);
    return known;
  }

  // A card is the issue itself, or a note whose description starts with the issue's address.
  private async find(url: string): Promise<string | undefined> {
    const { owner, number } = this.options;
    const listed = JSON.parse(await this.gh(["project", "item-list", String(number), "--owner", owner, "--limit", ITEM_LIMIT, "--format", "json"])) as { items: Item[] };
    return listed.items.find((item) => item.content?.url === url || item.content?.body?.split("\n")[0]?.trim() === url)?.id;
  }

  // The issue goes on the board when the board's account can see it; from another account's repository only a note can.
  private async add(url: string, title: string | undefined): Promise<string> {
    const { owner, number } = this.options;
    const added = await this.execute("gh", ["project", "item-add", String(number), "--owner", owner, "--url", url, "--format", "json"]);
    if (added.code === 0) return (JSON.parse(added.stdout) as { id: string }).id;

    const [, repo, issue] = /github\.com\/[^/]+\/([^/]+)\/(?:issues|pull)\/(\d+)/.exec(url) ?? [];
    const name = [repo && `${repo}#${issue}`, title].filter(Boolean).join(" ") || url;
    const note = await this.gh(["project", "item-create", String(number), "--owner", owner, "--title", name, "--body", url, "--format", "json"]);
    return (JSON.parse(note) as { id: string }).id;
  }

  private load(): Promise<Layout> {
    this.layout ??= this.read().catch((error) => {
      this.layout = undefined;
      throw error;
    });
    return this.layout;
  }

  private async read(): Promise<Layout> {
    const { owner, number } = this.options;
    const project = JSON.parse(await this.gh(["project", "view", String(number), "--owner", owner, "--format", "json"])) as { id: string };
    const fields = JSON.parse(await this.gh(["project", "field-list", String(number), "--owner", owner, "--format", "json"])) as {
      fields: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }>;
    };
    const status = fields.fields.find((field) => field.name === "Status" && field.options);
    if (!status) throw new Error(`board ${owner}/${number} has no Status field`);
    return { projectId: project.id, fieldId: status.id, options: new Map(status.options!.map((option) => [option.name, option.id])) };
  }

  private gh(args: string[]): Promise<string> {
    return run(this.execute, "gh", args);
  }
}
