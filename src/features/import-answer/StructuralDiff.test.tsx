import { expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";

mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { serializeFormat } = await import("@/domain/format");
const { StructuralDiff } = await import("./StructuralDiff");
it("shows changes to the original Unicode spelling despite equivalent NFC matches", () => {
  const { container } = render(
    <StructuralDiff
      after={serializeFormat("^lúc$", [], ["lúc"])}
      before={serializeFormat("^lúc$", [], ["lu\u0301c"])}
      kind="changed"
      path="src/Bank/formats/a.txt"
      reason={null}
    />
  );
  expect(container.textContent).toContain("− lu\u0301c");
  expect(container.textContent).toContain("+ lúc");
  expect(container.textContent).not.toContain(
    "importAnswer.diff.examplesUnchanged"
  );
});

it("shows a significant change in internal SMS whitespace", () => {
  const { container } = render(
    <StructuralDiff
      after={serializeFormat("^(.*)$", ["comment"], ["Pay 10"])}
      before={serializeFormat("^(.*)$", ["comment"], ["Pay  10"])}
      kind="changed"
      path="src/Bank/formats/a.txt"
      reason={null}
    />
  );
  expect(container.textContent).toContain("− Pay  10");
  expect(container.textContent).toContain("+ Pay 10");
});
