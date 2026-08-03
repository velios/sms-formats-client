import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAnswer } from "./core";
import amexAnswer from "./fixtures/amex-us.response.txt?raw";
import sberAnswer from "./fixtures/sber-ru.response.txt?raw";
import { ImportAnswerModal } from "./ImportAnswerModal";
import type { ImportAnswerDraftStore } from "./use-import-answer";

const BANK_PATH = "src/СберБанк-ru_4624";

// The bodies in force for every path the Sber answer touches. Handing them out
// as drafts keeps the screen off the network entirely: the hook takes a
// draft's body for free.
function bodiesOf(answer: string): Map<string, string> {
  const parsed = parseAnswer(answer);
  if (parsed.status !== "parsed") {
    return new Map();
  }
  return new Map(
    parsed.changes.map((change) => [
      change.path,
      "старое\\s+(\\d+)\n\n-----COLUMNS-----\noutcome\n\n-----EXAMPLE-----\nстарый пример",
    ])
  );
}

function fakeDraftStore(params: {
  bodies: Map<string, string>;
  editedPaths?: Set<string>;
}) {
  const { bodies, editedPaths = new Set<string>() } = params;
  const applied: string[] = [];
  const deleted: string[] = [];
  const store: ImportAnswerDraftStore = {
    getDraft: (filePath) => {
      const remoteContent = bodies.get(filePath);
      if (remoteContent === undefined) {
        return;
      }
      return {
        content: editedPaths.has(filePath) ? "моя правка" : remoteContent,
        baseSha: "base-sha",
        remoteContent,
        isDeleted: false,
      };
    },
    ensureDraft: () => undefined,
    applyUserEdit: (filePath) => applied.push(filePath),
    markDeleted: (filePath) => deleted.push(filePath),
  };
  return { store, applied, deleted };
}

function renderModal(
  answer: string,
  options: { editedPaths?: Set<string>; bankPath?: string } = {}
) {
  const bodies = bodiesOf(answer);
  const draft = fakeDraftStore({ bodies, editedPaths: options.editedPaths });
  const calculateIntersections = vi.fn(() => Promise.resolve());
  render(
    <ImportAnswerModal
      bankName="СберБанк"
      bankPath={options.bankPath ?? BANK_PATH}
      calculateIntersections={calculateIntersections}
      draftStore={draft.store}
      existingPaths={new Set(bodies.keys())}
      headSha="head-sha"
      onClose={() => undefined}
      prNumber={1002}
      repository={{ owner: "zenmoney", repo: "sms-formats" }}
      sourceRefName="head-sha"
    />
  );
  // Parsing happens on paste — there is no separate "parse" step.
  const field = screen.getByRole("textbox");
  fireEvent.paste(field);
  fireEvent.change(field, { target: { value: answer } });
  return { ...draft, calculateIntersections };
}

function manifest() {
  return screen.getByRole("listbox", { name: "Что изменится" });
}

beforeAll(async () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  // i18n reads localStorage while being evaluated, so it is loaded late.
  await import("@/i18n");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ImportAnswerModal: a real answer", () => {
  it("shows a row per block with the prose first and selected", () => {
    renderModal(sberAnswer);

    const options = within(manifest()).getAllByRole("option");
    // The agent's comment plus 10 writes and 4 deletes.
    expect(options).toHaveLength(15);
    expect(options[0]).toHaveTextContent("Комментарий агента");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Текст ответа вне блоков")).toBeInTheDocument();
    expect(
      screen.getByText(/Прошёл по всем 12 форматам из PR/)
    ).toBeInTheDocument();
  });

  it("counts the kinds and offers the write", () => {
    renderModal(sberAnswer);

    expect(within(manifest()).getAllByRole("option")).toHaveLength(15);
    expect(screen.getByText("10 изменённых")).toBeInTheDocument();
    expect(screen.getByText("4 удалённых")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Записать в черновики" })
    ).toBeEnabled();
  });

  it("gives a deletion its reason and the body in force", () => {
    renderModal(sberAnswer);

    const deletion = within(manifest())
      .getAllByRole("option")
      .find((option) => option.textContent?.includes("Номинальный счет"));
    fireEvent.click(deletion as HTMLElement);

    expect(screen.getByText("удалён")).toBeInTheDocument();
    expect(
      screen.getByText("Файл удаляется. Причина от агента:")
    ).toBeInTheDocument();
    expect(screen.getByText("Действующее тело файла")).toBeInTheDocument();
  });

  it("marks a row that overwrites a manual edit and counts it in the header", () => {
    const edited = new Set([
      `${BANK_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt`,
    ]);
    renderModal(sberAnswer, { editedPaths: edited });

    expect(
      screen.getByText("1 файл перезапишет вашу правку")
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Импорт перезапишет вашу ручную правку").length
    ).toBeGreaterThan(0);
  });

  it("writes on demand and turns the right pane into a summary", async () => {
    const { applied, deleted, calculateIntersections } =
      renderModal(sberAnswer);

    fireEvent.click(
      screen.getByRole("button", { name: "Записать в черновики" })
    );

    await waitFor(() =>
      expect(screen.getByText("Записано в черновики")).toBeInTheDocument()
    );
    expect(applied).toHaveLength(10);
    expect(deleted).toHaveLength(4);
    expect(calculateIntersections).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Пересечения пересчитаны.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "К черновикам" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Записать в черновики" })
    ).not.toBeInTheDocument();
  });
});

describe("ImportAnswerModal: degenerate answers", () => {
  it("says there is nothing to write when the answer is all prose", () => {
    renderModal(amexAnswer);

    expect(
      screen.getByText("Ответ разобран — файлов в нём нет")
    ).toBeInTheDocument();
    expect(screen.getByText("Записывать нечего.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Записать в черновики" })
    ).toBeDisabled();
    expect(within(manifest()).getAllByRole("option")).toHaveLength(1);
  });

  it("refuses a truncated answer, naming lines and keeping the prose", () => {
    renderModal(sberAnswer.split("\n").slice(0, 95).join("\n"));

    expect(
      screen.getByText("Ответ оборвался — импортировать нечего")
    ).toBeInTheDocument();
    expect(screen.getByText(/строка 90/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Записать в черновики" })
    ).toBeDisabled();
    expect(
      screen.getByText(/Прошёл по всем 12 форматам из PR/)
    ).toBeInTheDocument();
  });

  it("refuses the whole answer over one path outside the bank, keeping the text", () => {
    const answer = [
      "Поправил формат и заодно положил обзор.",
      "",
      `<file path="${BANK_PATH}/README.md">`,
      "# Форматы",
      "</file>",
      `<file path="src/Halyk Bank-kz_15360/formats/KZT Spisanie.txt">`,
      "^чужой",
      "</file>",
    ].join("\n");
    renderModal(answer);

    expect(
      screen.getByText("Ответ трогает файлы за пределами банка")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/в корне банка может лежать только senders.txt/)
    ).toBeInTheDocument();
    expect(screen.getByText(/другой банк/)).toBeInTheDocument();
    expect(within(manifest()).getAllByText("за границей")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Записать в черновики" })
    ).toBeDisabled();

    // The text stays in the field so the offending line can be fixed in place.
    fireEvent.click(screen.getByRole("button", { name: "Вставить заново" }));
    expect(screen.getByRole("textbox")).toHaveValue(answer);
  });
});
