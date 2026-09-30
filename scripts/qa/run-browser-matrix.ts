import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type MatrixRole = "guest" | "member" | "owner" | "server-admin";
export type MutationSurface = "read-only" | "personal-data" | "catalog-menu" | "menu-photo";

export interface MatrixFamily {
  id: string;
  sourceRow: number;
  scenario: string;
  roles: MatrixRole[];
  viewports: number[];
  mutationSurface: MutationSurface;
}

export interface MatrixCase {
  caseId: string;
  familyId: string;
  sourceRow: number;
  role: MatrixRole;
  viewport: number;
  mutationSurface: MutationSurface;
}

export interface BrowserMatrixSuite {
  schemaVersion: 1;
  sourceMatrix: string;
  familyCount: number;
  executionCount: number;
  families: MatrixFamily[];
  cases: MatrixCase[];
}

const ALL_ROLES: MatrixRole[] = ["guest", "member", "owner", "server-admin"];
const EXPECTED_FAMILIES = 57;
const EXPECTED_EXECUTIONS = 394;

function roleList(source: string): MatrixRole[] {
  const lower = source.toLocaleLowerCase("en-US");
  if (lower.includes("모든 해당 역할")) return [...ALL_ROLES];
  const roles: MatrixRole[] = [];
  if (/\bguest\b/.test(lower)) roles.push("guest");
  if (/\bmember\b/.test(lower) || lower.includes("작성자")) roles.push("member");
  if (/\bowner\b/.test(lower) || lower.includes("업주")) roles.push("owner");
  if (/\badmin\b/.test(lower) || lower.includes("서버 관리자")) roles.push("server-admin");
  return [...new Set(roles)];
}

function familyMutationSurface(sourceRow: number): MutationSurface {
  if (sourceRow === 48 || sourceRow === 49 || sourceRow === 50) return "catalog-menu";
  if (sourceRow === 51) return "menu-photo";
  if ([20, 21, 22, 24, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46].includes(sourceRow)) {
    return "personal-data";
  }
  return "read-only";
}

function parseTableRow(line: string): string[] {
  return line.split("|").slice(1, -1).map(part => part.trim());
}

export function deriveBrowserMatrix(sourceMarkdown: string, sourceMatrixPath = "docs/migration/ui-qa-matrix.md"): BrowserMatrixSuite {
  const familyRows = sourceMarkdown.split(/\r?\n/).filter(line => /^\|\s*\d+\s*\|/.test(line));
  const families: MatrixFamily[] = [];
  const cases: MatrixCase[] = [];
  const seenCaseIds = new Set<string>();

  for (const line of familyRows) {
    const columns = parseTableRow(line);
    if (columns.length < 5) throw new Error("Source matrix row is malformed.");
    const sourceRow = Number(columns[0]);
    const scenario = columns[1];
    const roles = roleList(columns[2]);
    const viewports = columns[3].split(",").map(item => Number(item.trim()));
    if (!Number.isInteger(sourceRow) || sourceRow < 1 || !scenario || roles.length === 0 || viewports.length === 0 || viewports.some(value => !Number.isInteger(value) || value < 1)) {
      throw new Error("Source matrix row is incomplete.");
    }
    if (new Set(roles).size !== roles.length || new Set(viewports).size !== viewports.length) throw new Error("Source matrix contains duplicate options.");
    const id = `ui-${String(sourceRow).padStart(2, "0")}`;
    const mutationSurface = familyMutationSurface(sourceRow);
    const family = { id, sourceRow, scenario, roles, viewports, mutationSurface } satisfies MatrixFamily;
    families.push(family);
    for (const role of roles) {
      for (const viewport of viewports) {
        const caseId = `${id}-${role}-${viewport}`;
        if (seenCaseIds.has(caseId)) throw new Error("Source matrix produced a duplicate case ID.");
        seenCaseIds.add(caseId);
        cases.push({ caseId, familyId: id, sourceRow, role, viewport, mutationSurface });
      }
    }
  }

  if (families.length !== EXPECTED_FAMILIES || families.some((family, index) => family.sourceRow !== index + 1)) {
    throw new Error("Source matrix must contain the exact 57 numbered scenario families.");
  }
  if (cases.length !== EXPECTED_EXECUTIONS || cases.length !== seenCaseIds.size) {
    throw new Error("Source matrix must expand to exactly 394 unique role/viewport cases.");
  }
  const row53 = families.find(family => family.sourceRow === 53);
  if (!row53 || row53.roles.length !== 4 || row53.viewports.length !== 2) throw new Error("Scenario family 53 must cover all roles and both viewports.");

  return {
    schemaVersion: 1,
    sourceMatrix: sourceMatrixPath.replaceAll("\\", "/"),
    familyCount: families.length,
    executionCount: cases.length,
    families,
    cases,
  };
}

export function assertSuiteMatchesSource(actual: unknown, expected: BrowserMatrixSuite): asserts actual is BrowserMatrixSuite {
  assert.deepStrictEqual(actual, expected, "Browser suite differs from the source UI matrix.");
}

export function assertProductionTargetSafe(target: "local" | "production", cases: readonly Pick<MatrixCase, "mutationSurface">[]): void {
  if (target === "production" && cases.some(testCase => testCase.mutationSurface === "catalog-menu" || testCase.mutationSurface === "menu-photo")) {
    throw new Error("Production catalog, menu, and menu-photo mutations are prohibited.");
  }
}

export function assertProductionExecutionSourceTrusted(
  target: "local" | "production",
  execute: boolean,
  selectedSourcePath: string,
  trustedSourcePath = "docs/migration/ui-qa-matrix.md",
): void {
  if (target === "production" && execute && resolve(selectedSourcePath) !== resolve(trustedSourcePath)) {
    throw new Error("Production browser execution requires the trusted canonical matrix source.");
  }
}

interface Arguments {
  suitePath: string;
  sourcePath: string;
  dryRun: boolean;
  generate: boolean;
  execute: boolean;
  target: "local" | "production";
}

function parseArgs(argv: string[]): Arguments {
  const value = (flag: string, fallback: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] ?? "" : fallback;
  };
  const target = value("--target", "local");
  if (target !== "local" && target !== "production") throw new Error("Target must be local or production.");
  return {
    suitePath: value("--suite", "docs/migration/browser-qa-57.json"),
    sourcePath: value("--source", "docs/migration/ui-qa-matrix.md"),
    dryRun: argv.includes("--dry-run"),
    generate: argv.includes("--generate-suite"),
    execute: argv.includes("--execute"),
    target,
  };
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  assertProductionExecutionSourceTrusted(args.target, args.execute && !args.dryRun && !args.generate, args.sourcePath);
  const sourceMarkdown = await readFile(resolve(args.sourcePath), "utf8");
  const derived = deriveBrowserMatrix(sourceMarkdown);
  if (args.generate) {
    await writeFile(resolve(args.suitePath), `${JSON.stringify(derived, null, 2)}\n`, { encoding: "utf8" });
    process.stdout.write(`Generated ${derived.familyCount} families and ${derived.executionCount} cases.\n`);
    return;
  }
  const actual = JSON.parse(await readFile(resolve(args.suitePath), "utf8")) as unknown;
  assertSuiteMatchesSource(actual, derived);
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({ status: "PASS", matrixMatchesSource: true, familyCount: derived.familyCount, executionCount: derived.executionCount })}\n`);
    return;
  }
  if (args.execute) {
    assertProductionTargetSafe(args.target, derived.cases);
    throw new Error("No browser execution adapter is installed; this command made no browser or network request.");
  }
  throw new Error("Use --dry-run to validate the matrix or --execute with a configured local runner.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    const safeMessage = error instanceof Error && /Production catalog, menu, and menu-photo mutations are prohibited\./.test(error.message)
      ? error.message
      : error instanceof Error && /Production browser execution requires the trusted canonical matrix source\./.test(error.message)
        ? error.message
      : "Browser matrix command failed or execution is unavailable; no browser run was claimed.";
    process.stderr.write(`${safeMessage}\n`);
    process.exitCode = 1;
  });
}
