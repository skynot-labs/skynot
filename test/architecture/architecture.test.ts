import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkArchitecture, checkBoundaries, type SourceFile } from "./rules";

function readSources(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((full) => !full.split(path.sep).some((segment) => segment === "node_modules" || segment === "dist"))
    .map((full) => ({ path: path.relative(process.cwd(), full).split(path.sep).join("/"), content: readFileSync(full, "utf8") }));
}

const file = (filePath: string, content: string): SourceFile => ({ path: filePath, content });

describe("architecture rules on the real source", () => {
  it("has no violations", () => {
    expect(checkArchitecture(readSources("src"))).toEqual([]);
  });
});

describe("boundaries between the office, the studio and the contract on the real source", () => {
  it("has no violations", () => {
    const sources = ["src", "console", "packages/contract/src"].flatMap(readSources);
    expect(checkBoundaries(sources)).toEqual([]);
  });
});

describe("boundaries between the office, the studio and the contract", () => {
  it("lets the studio import itself, packages and the contract", () => {
    const files = [
      file("console/src/main.tsx", `import { render } from "preact";\nimport { CONTRACT } from "@skynot/contract";\nimport { App } from "./app";`),
      file("console/test/gateway.test.ts", `import { StateSchema } from "../../packages/contract/src/state";`),
    ];
    expect(checkBoundaries(files)).toEqual([]);
  });

  it("rejects the studio importing the office, as a type, a value or a dynamic import, from any of its folders", () => {
    const files = [
      file("console/src/application/gateway.ts", `import type { State } from "../../../src/app/http/state";`),
      file("console/test/gateway.test.ts", `import { buildApi } from "../../src/app/http/api";`),
      file("console/e2e/serve.ts", `await import("../../src/app/main.ts");`),
      file("console/e2e/support.ts", "await import(`../../src/app/main.ts`);"),
      file("console/vite.config.ts", `export { port } from "../src/app/port";`),
      file("console/scripts/export-github.mjs", `import { CONTRACT } from "../../src/app/http/meta.ts";`),
    ];
    expect(checkBoundaries(files).map((violation) => violation.file)).toEqual(files.map((source) => source.path));
  });

  it("lets the studio start an office as a process, by the path of its entry point", () => {
    const files = [file("console/e2e/serve.ts", `spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../../src/app/main.ts", import.meta.url))]);`)];
    expect(checkBoundaries(files)).toEqual([]);
  });

  it("lets the contract import itself and zod", () => {
    const files = [file("packages/contract/src/state.ts", `import { z } from "zod";\nimport { ProjectIdSchema } from "./formats";`)];
    expect(checkBoundaries(files)).toEqual([]);
  });

  it("rejects the contract importing the office, the studio or any package other than zod", () => {
    const files = [
      file("packages/contract/src/state.ts", `import type { Order } from "../../../src/orders";`),
      file("packages/contract/src/events.ts", `import { format } from "../../../console/src/application/format";`),
      file("packages/contract/src/meta.ts", `import { parse } from "yaml";`),
      file("packages/contract/src/formats.ts", `import { randomUUID } from "node:crypto";`),
      file("packages/contract/src/commands.ts", `const studio = await import("@skynot/studio");`),
    ];
    expect(checkBoundaries(files).map((violation) => violation.file)).toEqual(files.map((source) => source.path));
  });

  it("lets the office import the contract and its own packages", () => {
    const files = [file("src/app/http/state.ts", `import { StateSchema } from "@skynot/contract";\nimport { Hono } from "hono";`)];
    expect(checkBoundaries(files)).toEqual([]);
  });

  it("rejects the office importing the studio, by path or by package name", () => {
    const files = [
      file("src/app/main.ts", `import type { Appearance } from "../../console/src/application/appearance";`),
      file("src/app/http/api.ts", `const tokens = await import("../../../console/src/design/tokens.json");`),
      file("src/app/shop.ts", `import { model } from "@skynot/studio/src/studio/model";`),
    ];
    expect(checkBoundaries(files).map((violation) => violation.file)).toEqual(files.map((source) => source.path));
  });
});

describe("architecture rules", () => {
  it("allows a domain file to import another domain file of its context", () => {
    const files = [file("src/orders/domain/order.ts", `import { Status } from "./status";`)];
    expect(checkArchitecture(files)).toEqual([]);
  });

  it("allows any layer to import the kernel", () => {
    const files = [file("src/orders/domain/order.ts", `import { newId } from "../../kernel";`)];
    expect(checkArchitecture(files)).toEqual([]);
  });

  it("ignores package imports", () => {
    const files = [file("src/orders/domain/order.ts", `import { z } from "zod";`)];
    expect(checkArchitecture(files)).toEqual([]);
  });

  it("rejects a domain file importing an adapter", () => {
    const files = [file("src/orders/domain/order.ts", `import { Store } from "../adapters/store";`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });

  it("rejects a domain file importing application code", () => {
    const files = [file("src/orders/domain/order.ts", `import { sign } from "../application/sign";`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });

  it("rejects application code importing an adapter", () => {
    const files = [file("src/orders/application/sign.ts", `import { Store } from "../adapters/store";`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });

  it("allows an adapter to import the domain and application of its context", () => {
    const files = [
      file("src/orders/adapters/store.ts", `import { Order } from "../domain/order";\nimport { sign } from "../application/sign";`),
    ];
    expect(checkArchitecture(files)).toEqual([]);
  });

  it("rejects one context importing another", () => {
    const files = [file("src/delivery/application/open-pr.ts", `import { Order } from "../../orders/domain/order";`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });

  it("rejects the kernel importing a context", () => {
    const files = [file("src/kernel/id.ts", `import { Order } from "../orders/domain/order";`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });

  it("lets the app layer import the public index of a context", () => {
    const files = [
      file("src/app/order-desk.ts", `import { OrderService } from "../orders";\nimport { Desk } from "../manager/index";`),
    ];
    expect(checkArchitecture(files)).toEqual([]);
  });

  it("rejects the app layer reaching into a context's internals", () => {
    const files = [file("src/app/order-desk.ts", `import { sign } from "../orders/domain/work-order";`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });

  it("rejects a context importing the app layer", () => {
    const files = [file("src/orders/application/sign.ts", `import { wire } from "../../app/wire";`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });

  it("lets main and the HTTP layer reach project registration", () => {
    const files = [
      file("src/app/main.ts", `import { YamlProjectRegistry } from "../projects";`),
      file("src/app/http/api.ts", `import type { ProjectRegistry } from "../../projects";`),
      file("src/projects/domain/ports.ts", `export interface ProjectRegistry {}`),
    ];
    expect(checkArchitecture(files)).toEqual([]);
  });

  it("rejects any other app file that names the project registry, so no desk, Manager or runner can register a project", () => {
    const files = [
      file("src/app/shop.ts", `import { YamlProjectRegistry } from "../projects";`),
      file("src/app/briefing-desk.ts", `import type { ProjectRegistry } from "../projects";`),
      file("src/app/projects.ts", `import { YamlProjectCatalog } from "../projects";`),
    ];
    expect(checkArchitecture(files).map((violation) => [violation.file, violation.imports])).toEqual([
      ["src/app/shop.ts", "YamlProjectRegistry"],
      ["src/app/briefing-desk.ts", "ProjectRegistry"],
    ]);
  });

  it("catches dynamic imports too", () => {
    const files = [file("src/orders/domain/order.ts", `const store = await import("../adapters/store");`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });
});
