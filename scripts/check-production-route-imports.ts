import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const routeRoot = new URL("../src/routes/", import.meta.url);
const PROTECTED_STORE_MUTATIONS = new Map<string, ReadonlySet<string>>([
  [
    "annual-return-store",
    new Set([
      "assignOwner",
      "markDocumentMissing",
      "markDocumentReceived",
      "updatePaymentStatus",
      "updateSignatureStatus",
      "updateReviewStatus",
      "completeChecklistItem",
      "reopenChecklistItem",
      "togglePacketRequirement",
      "submitFilingPacket",
      "acceptFilingReceipt",
      "addCaseNote",
      "sendFollowUpNow",
      "markFiled",
    ]),
  ],
  [
    "client-portal-store",
    new Set([
      "uploadClientDocument",
      "replaceClientDocument",
      "reviewClientDocument",
      "uploadPaymentProof",
      "acceptPaymentProof",
      "rejectPaymentProof",
      "sendDocumentReviewFollowUpNow",
      "sendPaymentProofFollowUpNow",
    ]),
  ],
]);

export type ProductionRouteScanInput = {
  routeFiles: readonly string[];
  readRoute(file: string): Promise<string>;
};

export type ProductionRouteScanResult = {
  scanned: number;
  failures: Array<{ file: string; pattern: string }>;
};

function protectedStoreName(moduleSpecifier: string): string | undefined {
  for (const storeName of PROTECTED_STORE_MUTATIONS.keys()) {
    if (
      moduleSpecifier === storeName ||
      moduleSpecifier.endsWith(`/lib/${storeName}`) ||
      moduleSpecifier.endsWith(`/${storeName}`)
    ) {
      return storeName;
    }
  }
  return undefined;
}

function addFailure(
  failures: ProductionRouteScanResult["failures"],
  file: string,
  pattern: string,
): void {
  if (!failures.some((failure) => failure.file === file && failure.pattern === pattern)) {
    failures.push({ file, pattern });
  }
}

function inspectSource(
  file: string,
  source: string,
  failures: ProductionRouteScanResult["failures"],
): void {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause
    ) {
      const storeName = protectedStoreName(node.moduleSpecifier.text);
      if (storeName && !node.importClause.isTypeOnly) {
        const bindings = node.importClause.namedBindings;
        if (node.importClause.name || (bindings && ts.isNamespaceImport(bindings))) {
          addFailure(failures, file, `namespace import from ${storeName}`);
        }
        if (bindings && ts.isNamedImports(bindings)) {
          const mutations = PROTECTED_STORE_MUTATIONS.get(storeName)!;
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            const importedName = (element.propertyName ?? element.name).text;
            if (mutations.has(importedName)) addFailure(failures, file, `${importedName}(`);
          }
        }
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const storeName = protectedStoreName(node.moduleSpecifier.text);
      if (storeName) addFailure(failures, file, `re-export from ${storeName}`);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const storeName = protectedStoreName(node.arguments[0].text);
      if (storeName) addFailure(failures, file, `dynamic import from ${storeName}`);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

export async function scanProductionRoutes(
  input: ProductionRouteScanInput,
): Promise<ProductionRouteScanResult> {
  const failures: ProductionRouteScanResult["failures"] = [];
  for (const file of input.routeFiles) {
    inspectSource(file, await input.readRoute(file), failures);
  }
  return { scanned: input.routeFiles.length, failures };
}

async function main(): Promise<void> {
  const routeFiles = (await readdir(routeRoot))
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
    .sort();
  const result = await scanProductionRoutes({
    routeFiles,
    readRoute: (file) => readFile(new URL(file, routeRoot), "utf8"),
  });

  for (const failure of result.failures) {
    console.error(`FAIL ${failure.file}: forbidden browser mutation ${failure.pattern}`);
  }
  if (result.failures.length > 0) process.exitCode = 1;
  else console.log(`PASS production route import check (${result.scanned} routes scanned)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
