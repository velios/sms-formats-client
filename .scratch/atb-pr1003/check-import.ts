// Round-trip check without the UI: does the client's answer parser accept the
// agent's reply, and does every changed path belong to the bank?
import { readFileSync } from "node:fs";
import { classifyPathViolation, isImportablePath, parseAnswer } from "@/features/import-answer/core";

const BANK_PATH = "src/АТБ-ru_4679";
const parsed = parseAnswer(readFileSync(process.argv[2] as string, "utf8"));
if (parsed.status !== "parsed") {
  console.log("parse:", parsed.status, JSON.stringify(parsed, null, 2));
} else {
  console.log("parse: ok,", parsed.changes.length, "изменений");
  for (const change of parsed.changes) {
    const path = "path" in change ? change.path : `${change.from} → ${change.to}`;
    const checked = "path" in change ? change.path : change.to;
    console.log(
      ` ${change.kind}\t${path}\t${isImportablePath(checked, BANK_PATH) ? "путь принимается" : `отклонён: ${classifyPathViolation(checked, BANK_PATH)}`}`
    );
  }
}
