import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const VALID_STORAGE   = ["kv", "db", "none"];
const VALID_AUDIENCES = ["everyone", "adults", "children"];

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });

  it("entrypoint is index.html", () => expect(manifest.entrypoint).toBe("index.html"));
  it("runtime is static",        () => expect(manifest.runtime).toBe("static"));

  it("storage is declared and valid", () => {
    expect(manifest.storage, "storage field is required").toBeTruthy();
    expect(VALID_STORAGE).toContain(manifest.storage);
  });

  it("version follows semver", () => expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/));

  it("permissions.default_audience is valid", () => {
    expect(VALID_AUDIENCES).toContain(manifest.permissions.default_audience);
  });

  it("permissions.requires_approval is boolean", () => {
    expect(typeof manifest.permissions.requires_approval).toBe("boolean");
  });

  it("data_access has reads and writes arrays", () => {
    expect(Array.isArray(manifest.data_access.reads)).toBe(true);
    expect(Array.isArray(manifest.data_access.writes)).toBe(true);
  });

  // The app only HIDES its write controls from children; the hub is what
  // refuses them, and only where the manifest says so. Without these, any
  // member could upload, create documents, or rewrite the folder map — whose
  // visibility an adult's next upload is filed under.
  it("leaves document, file and folder writes to adults", () => {
    expect(manifest.document_acls.write.require_role).toBe("adult");
    expect(manifest.file_acls.write.require_role).toBe("adult");
    expect(manifest.store_acls.folders_meta.write.require_role).toBe("adult");
    expect(manifest.store_acls.folders_private.write.require_role).toBe("adult");
  });

  it("keeps roster spaces steward-only, and file reads behind the document's sharing", () => {
    expect(manifest.document_acls.write.roster_steward_only).toBe(true);
    expect(manifest.file_acls.write.roster_steward_only).toBe(true);
    expect(manifest.file_acls.read).toBe("document_acl");
    // The folder maps too: an adult who is not the steward passes the role
    // rule, and could otherwise relabel the folders the steward files under.
    expect(manifest.store_acls.folders_meta.write.roster_steward_only).toBe(true);
    expect(manifest.store_acls.folders_private.write.roster_steward_only).toBe(true);
  });

  // Children read the open map to list the folders that are for everyone. The
  // folders that are not for everyone are recorded apart, where a child's
  // session is refused: the name of a folder says something by itself.
  it("serves the open folder map to everyone and the private one to adults", () => {
    expect(manifest.store_acls.folders_meta.read).toBeUndefined();
    expect(manifest.store_acls.folders_private.read.require_role).toBe("adult");
  });
});

// HTML escaping protects an attribute's VALUE, not script inside it: the
// parser decodes &#39; back to a quote before an inline handler is compiled.
// So nothing is interpolated into one — rows carry data attributes and a
// delegated listener reads them (see folderListHtml in src/logic.js).
describe("src/index.html inline handlers", () => {
  const html = readFileSync(join(__dirname, "../src/index.html"), "utf-8");
  it("interpolate nothing", () => {
    const handlers = html.match(/\son[a-z]+="[^"]*"/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) expect(handler).not.toContain("${");
  });
});
