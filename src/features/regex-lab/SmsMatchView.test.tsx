import { expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";
import { testRegex } from "@/domain/format";

mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { MatchOverlayTextarea } = await import("./SmsMatchView");

it("highlights either capture when NFC maps them onto an overlapping original cluster", () => {
  const text = "fooa\u0308\u0301";
  const result = testRegex("^(fooä)(.*)$", text);
  const props = {
    text,
    result,
    activeMatchRange: null,
    progress: null,
    onTextChange: () => undefined,
  };
  const { container, rerender } = render(
    <MatchOverlayTextarea {...props} hoveredGroup={1} />
  );
  expect(container.querySelector('[title="Group 1"]')?.textContent).toBe(text);
  expect(container.querySelector('[title="Group 1"]')?.className).toContain(
    "brightness-150"
  );

  rerender(<MatchOverlayTextarea {...props} hoveredGroup={2} />);
  expect(container.querySelector('[title="Group 1"]')?.textContent).toBe("foo");
  expect(container.querySelector('[title="Group 2"]')?.textContent).toBe(
    "a\u0308\u0301"
  );
  expect(container.querySelector('[title="Group 2"]')?.className).toContain(
    "brightness-150"
  );
  expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe(
    text
  );
  expect(container.querySelector("textarea")?.value).toBe(text);
});
