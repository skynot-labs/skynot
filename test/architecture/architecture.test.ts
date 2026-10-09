import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkArchitecture, type SourceFile } from "./rules";

function readSources(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => {
      const full = path.join(entry.parentPath, entry.name);
      return { path: path.relative(process.cwd(), full).split(path.sep).join("/"), content: readFileSync(full, "utf8") };
    });
}

const file = (filePath: string, content: string): SourceFile => ({ path: filePath, content });

describe("architecture rules on the real source", () => {
  it("has no violations", () => {
    expect(checkArchitecture(readSources("src"))).toEqual([]);
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

  it("catches dynamic imports too", () => {
    const files = [file("src/orders/domain/order.ts", `const store = await import("../adapters/store");`)];
    expect(checkArchitecture(files)).toHaveLength(1);
  });
});
