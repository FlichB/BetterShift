import { describe, expect, it } from "vitest";
import { ENTRY_TITLE_DEFAULT, entryTitle, holderDisplayName, validateEntryTitle } from "@/lib/rotation/entry-title";

const guenther = { name: "Günther Maier", email: "g.maier@example.at" };

describe("entryTitle", () => {
  it("fills every placeholder", () => {
    expect(entryTitle(ENTRY_TITLE_DEFAULT, guenther, "Samstagsdienst")).toBe("Günther Dienst");
    expect(entryTitle("{Name} – {Dienst}", guenther, "Samstagsdienst")).toBe("Günther Maier – Samstagsdienst");
  });

  it("uses the whole name when it has one word, and collapses whitespace", () => {
    expect(entryTitle("{Vorname} Dienst", { name: "Anna", email: null }, "x")).toBe("Anna Dienst");
    expect(entryTitle("  {Vorname}   Dienst ", { name: "  Peter   Huber ", email: null }, "x")).toBe("Peter Dienst");
  });

  it("falls back to the e-mail local part when the name is empty", () => {
    expect(entryTitle("{Vorname} Dienst", { name: " ", email: "office.helper@example.at" }, "x")).toBe("office.helper Dienst");
    expect(holderDisplayName({ name: null, email: null })).toBe("");
  });
});

describe("validateEntryTitle", () => {
  it("accepts the default and any template with a name placeholder", () => {
    expect(validateEntryTitle(ENTRY_TITLE_DEFAULT)).toBe("ok");
    expect(validateEntryTitle("Samstag: {Name}")).toBe("ok");
  });

  it("rejects templates without a name, with unknown placeholders or stray braces", () => {
    expect(validateEntryTitle("{Dienst}")).toBe("missingName");
    expect(validateEntryTitle("{vorname} Dienst")).toBe("unknownPlaceholder");
    expect(validateEntryTitle("{Vorname} {Datum}")).toBe("unknownPlaceholder");
    expect(validateEntryTitle("{Vorname} Dienst}")).toBe("unknownPlaceholder");
  });

  it("checks the trimmed length", () => {
    expect(validateEntryTitle("   ")).toBe("length");
    expect(validateEntryTitle(`{Name} ${"x".repeat(100)}`)).toBe("length");
  });
});
