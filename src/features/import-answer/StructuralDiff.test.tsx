import { expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";

mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { serializeFormat } = await import("@/domain/format");
const { StructuralDiff } = await import("./StructuralDiff");
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
