import { describe, it, expect } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  isImage, isPdf, fileGlyph, formatBytes, accept,
  folderPathSafe, MAX_FOLDER_NAME_LENGTH, searchableFields } from "../src/logic.js";

// ── ALLOWED_EXTENSIONS ────────────────────────────────────────────────────────
describe("ALLOWED_EXTENSIONS", () => {
  it("includes image/jpeg", () => expect(ALLOWED_EXTENSIONS["image/jpeg"]).toBeDefined());
  it("includes application/pdf", () => expect(ALLOWED_EXTENSIONS["application/pdf"]).toBeDefined());
  it("does not include non-standard image/jpg", () => {
    expect(ALLOWED_EXTENSIONS["image/jpg"]).toBeUndefined();
  });
  it("every entry has ext, label, and glyph", () => {
    for (const [mime, entry] of Object.entries(ALLOWED_EXTENSIONS)) {
      expect(entry.ext,   `${mime} missing ext`).toBeTruthy();
      expect(entry.label, `${mime} missing label`).toBeTruthy();
      expect(entry.glyph, `${mime} missing glyph`).toBeTruthy();
    }
  });
});

// ── isImage ───────────────────────────────────────────────────────────────────
describe("isImage", () => {
  it("returns true for image/jpeg",  () => expect(isImage("image/jpeg")).toBe(true));
  it("returns true for image/png",   () => expect(isImage("image/png")).toBe(true));
  it("returns true for image/heic",  () => expect(isImage("image/heic")).toBe(true));
  it("returns false for application/pdf", () => expect(isImage("application/pdf")).toBe(false));
  it("returns false for undefined",  () => expect(isImage(undefined)).toBe(false));
  it("returns false for empty string", () => expect(isImage("")).toBe(false));
});

// ── isPdf ─────────────────────────────────────────────────────────────────────
describe("isPdf", () => {
  it("returns true for application/pdf",  () => expect(isPdf("application/pdf")).toBe(true));
  it("returns false for image/jpeg",      () => expect(isPdf("image/jpeg")).toBe(false));
  it("returns false for undefined",       () => expect(isPdf(undefined)).toBe(false));
});

// ── fileGlyph ─────────────────────────────────────────────────────────────────
describe("fileGlyph", () => {
  it("returns frame for image/jpeg",          () => expect(fileGlyph("image/jpeg")).toBe("frame"));
  it("returns document for application/pdf",  () => expect(fileGlyph("application/pdf")).toBe("document"));
  it("returns note for text/plain",           () => expect(fileGlyph("text/plain")).toBe("note"));
  it("returns document for unknown mime type", () => expect(fileGlyph("application/octet-stream")).toBe("document"));
  it("returns document for undefined",        () => expect(fileGlyph(undefined)).toBe("document"));
});

// ── formatBytes ───────────────────────────────────────────────────────────────
describe("formatBytes", () => {
  it("formats bytes under 1 KB",         () => expect(formatBytes(512)).toBe("512 B"));
  it("formats exactly 1 KB",             () => expect(formatBytes(1024)).toBe("1.0 KB"));
  it("formats KB range",                 () => expect(formatBytes(2048)).toBe("2.0 KB"));
  it("formats exactly 1 MB",             () => expect(formatBytes(1024 * 1024)).toBe("1.0 MB"));
  it("formats MB range",                 () => expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB"));
  it("formats 0 bytes",                  () => expect(formatBytes(0)).toBe("0 B"));
});

// ── accept ────────────────────────────────────────────────────────────────────
describe("accept", () => {
  it("returns a comma-separated string of MIME types", () => {
    const result = accept();
    expect(typeof result).toBe("string");
    expect(result.split(",").length).toBe(Object.keys(ALLOWED_EXTENSIONS).length);
  });
  it("includes image/jpeg", () => expect(accept()).toContain("image/jpeg"));
  it("includes application/pdf", () => expect(accept()).toContain("application/pdf"));
});

// ── folderPathSafe ─────────────────────────────────────────────────────────────
// folders_meta edits go through PATCH /api/store as dot-separated paths, so a
// folder name is also a path segment. Names that can't be one fall back to the
// racy whole-blob write, which is exactly what the patch path exists to avoid.
describe("folderPathSafe", () => {
  it("accepts ordinary folder names", () => {
    expect(folderPathSafe("Taxes")).toBe(true);
    expect(folderPathSafe("School 2026")).toBe(true);
    expect(folderPathSafe("a".repeat(MAX_FOLDER_NAME_LENGTH))).toBe(true);
  });
  it("rejects a dot — it would address a nested object instead of the folder", () => {
    expect(folderPathSafe("taxes.2026")).toBe(false);
  });
  it("rejects the prototype keys the hub refuses outright", () => {
    for (const name of ["__proto__", "prototype", "constructor"]) {
      expect(folderPathSafe(name)).toBe(false);
    }
  });
  it("rejects empty and over-long names", () => {
    expect(folderPathSafe("")).toBe(false);
    expect(folderPathSafe("a".repeat(MAX_FOLDER_NAME_LENGTH + 1))).toBe(false);
    expect(folderPathSafe(undefined)).toBe(false);
  });
});

describe("searchableFields", () => {
  it("matches on the file kind as well as the name", () => {
    const fields = searchableFields({ title: "Lease 2026", mimeType: "application/pdf" });
    expect(fields).toContain("Lease 2026");
    expect(fields).toContain("application/pdf"); // so typing "pdf" finds it
  });
});
