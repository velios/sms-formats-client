import { describe, expect, it } from "vitest";
import { ALLOWED_COLUMNS } from "./types";

describe("ALLOWED_COLUMNS", () => {
  it("matches sms-formats column reference", () => {
    expect(ALLOWED_COLUMNS.map((column) => column.name)).toEqual([
      "payee",
      "income",
      "outcome",
      "fee",
      "cashback",
      "op_income",
      "op_outcome",
      "balance",
      "av_balance",
      "comment",
      "instrument",
      "op_instrument",
      "acc_instrument",
      "date",
      "syncid",
      "mcc",
    ]);
  });
});
