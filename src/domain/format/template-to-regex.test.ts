import { describe, expect, it } from "vitest";
import {
  convertTemplateToRegex,
  extractTemplatePlaceholders,
} from "./template-to-regex";

describe("extractTemplatePlaceholders", () => {
  it("returns unique placeholders in declaration order", () => {
    const result = extractTemplatePlaceholders(
      "Покупка ${outcome} ${instrument}. Баланс ${balance} ${instrument}"
    );
    expect(result).toEqual(["outcome", "instrument", "balance"]);
  });
});

describe("convertTemplateToRegex", () => {
  it("builds rough regex with generic groups", () => {
    const result = convertTemplateToRegex(
      "Оплата ${outcome} ${payee}",
      "rough"
    );
    expect(result).toBe("^Оплата (.+?) (.+?)$");
  });

  it("builds accurate regex with typed placeholders", () => {
    const result = convertTemplateToRegex(
      "Покупка ${outcome} ${instrument}. MCC ${mcc}",
      "accurate"
    );
    expect(result).toBe(
      "^Покупка\\s+([\\d\\s.,]+)\\s+([A-Za-zА-Яа-я]{3}|[$€£¥₽])\\.\\s+MCC\\s+(\\d{4})$"
    );
  });

  it("uses date format tokens when date has #template", () => {
    const result = convertTemplateToRegex(
      "Дата ${date#dd.MM.yyyy} в ${time}",
      "accurate"
    );
    expect(result).toBe(
      "^Дата\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\s+в\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?)$"
    );
  });
});
