import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { serializeFormat } from "@/domain/format";
import { StructuralDiff } from "./StructuralDiff";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
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
