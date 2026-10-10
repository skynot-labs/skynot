import { exec, run, type Exec } from "../../kernel/process";
import type { Board, BoardStage } from "../domain";

interface Layout {
  projectId: string;
  fieldId: string;
  options: Map<string, string>;
}

// A user or organization project (v2) driven through `gh project`; the Status field holds the stage.
export class GhBoard implements Board {
  private layout: Promise<Layout> | undefined;

  constructor(
    private readonly options: { owner: string; number: number; columns: Readonly<Record<BoardStage, string>> },
    private readonly execute: Exec = exec,
  ) {}

  async place({ url, stage }: { url: string; stage: BoardStage }): Promise<void> {
    const { owner, number, columns } = this.options;
    const layout = await this.load();
    const option = layout.options.get(columns[stage]);
    if (!option) throw new Error(`board ${owner}/${number} has no Status option named "${columns[stage]}"`);

    const added = JSON.parse(await this.gh(["project", "item-add", String(number), "--owner", owner, "--url", url, "--format", "json"])) as { id: string };
    await this.gh(["project", "item-edit", "--id", added.id, "--project-id", layout.projectId, "--field-id", layout.fieldId, "--single-select-option-id", option]);
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
