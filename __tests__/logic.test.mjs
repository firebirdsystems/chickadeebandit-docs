import { describe, it, expect } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  isImage, isPdf, fileIcon, formatBytes, accept,
  folderPathSafe, MAX_FOLDER_NAME_LENGTH,
} from "../src/logic.js";

// ── ALLOWED_EXTENSIONS ────────────────────────────────────────────────────────
describe("ALLOWED_EXTENSIONS", () => {
  it("includes image/jpeg", () => expect(ALLOWED_EXTENSIONS["image/jpeg"]).toBeDefined());
  it("includes application/pdf", () => expect(ALLOWED_EXTENSIONS["application/pdf"]).toBeDefined());
  it("does not include non-standard image/jpg", () => {
    expect(ALLOWED_EXTENSIONS["image/jpg"]).toBeUndefined();
  });
  it("every entry has ext, label, and icon", () => {
    for (const [mime, entry] of Object.entries(ALLOWED_EXTENSIONS)) {
      expect(entry.ext,   `${mime} missing ext`).toBeTruthy();
      expect(entry.label, `${mime} missing label`).toBeTruthy();
      expect(entry.icon,  `${mime} missing icon`).toBeTruthy();
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

// ── fileIcon ──────────────────────────────────────────────────────────────────
describe("fileIcon", () => {
  it("returns 🖼️ for image/jpeg",        () => expect(fileIcon("image/jpeg")).toBe("🖼️"));
  it("returns 📄 for application/pdf",   () => expect(fileIcon("application/pdf")).toBe("📄"));
  it("returns 📃 for text/plain",        () => expect(fileIcon("text/plain")).toBe("📃"));
  it("returns 📎 for unknown mime type", () => expect(fileIcon("application/octet-stream")).toBe("📎"));
  it("returns 📎 for undefined",         () => expect(fileIcon(undefined)).toBe("📎"));
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
