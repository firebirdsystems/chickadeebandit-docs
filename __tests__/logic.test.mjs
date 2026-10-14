import { describe, it, expect } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  isImage, isPdf, fileGlyph, formatBytes, accept,
  folderPathSafe, MAX_FOLDER_NAME_LENGTH, searchableFields,
  DOCS_PAGE_LIMIT, fetchAllDocs, parseFoldersMeta, folderEntry, buildFolderList,
  visibilityKind, visibleFolders, folderNameTaken, resolveVisibility, canChangeDoc,
  OPEN_FOLDERS_KEY, PRIVATE_FOLDERS_KEY, folderStoreKey, mergeFolderStores, planFolderWrites, planFolderMigration,
  folderListHtml, outcomeUnknown, sameFile, docForFile } from "../src/logic.js";

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

// ── fetchAllDocs ──────────────────────────────────────────────────────────────
// The hub pages the document list (50 by default, 100 at most). A rename, a
// visibility change and a folder delete all act on "every document in the
// folder", so one page is not an answer.
describe("fetchAllDocs", () => {
  const pager = (pages) => {
    const cursors = [];
    const fetchPage = async (cursor) => {
      cursors.push(cursor);
      const index = cursor === null ? 0 : Number(cursor);
      return { docs: pages[index], nextCursor: index + 1 < pages.length ? String(index + 1) : null };
    };
    return { fetchPage, cursors };
  };

  it("asks for the largest page the hub serves", () => expect(DOCS_PAGE_LIMIT).toBe(100));

  it("follows the cursor to the end and keeps the order", async () => {
    const { fetchPage, cursors } = pager([[{ id: "a" }, { id: "b" }], [{ id: "c" }], [{ id: "d" }]]);
    expect((await fetchAllDocs(fetchPage)).map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
    expect(cursors).toEqual([null, "1", "2"]);
  });

  it("reads a single page once", async () => {
    const { fetchPage, cursors } = pager([[{ id: "a" }]]);
    expect(await fetchAllDocs(fetchPage)).toEqual([{ id: "a" }]);
    expect(cursors).toEqual([null]);
  });

  it("keeps going past an empty page that says more follow", async () => {
    const { fetchPage } = pager([[], [{ id: "a" }]]);
    expect(await fetchAllDocs(fetchPage)).toEqual([{ id: "a" }]);
  });

  it("fails — rather than returning the part it has — when a later page fails", async () => {
    let calls = 0;
    const fetchPage = async () => {
      if (++calls === 2) throw new Error("Could not load documents (429)");
      return { docs: [{ id: "a" }], nextCursor: "next" };
    };
    await expect(fetchAllDocs(fetchPage)).rejects.toThrow("429");
  });

  it("refuses a page that is not a list", async () => {
    await expect(fetchAllDocs(async () => ({ docs: { error: "nope" }, nextCursor: null }))).rejects.toThrow();
  });

  it("stops on a cursor that repeats instead of looping forever", async () => {
    await expect(fetchAllDocs(async () => ({ docs: [], nextCursor: "same" }))).rejects.toThrow("did not advance");
  });

  it("stops at the page ceiling", async () => {
    let n = 0;
    await expect(fetchAllDocs(async () => ({ docs: [], nextCursor: String(++n) }), { maxPages: 3 })).rejects.toThrow("Too many");
    expect(n).toBe(3);
  });
});

// ── Folder metadata and the folder list ───────────────────────────────────────
// Folder names are chosen by people and used as keys. On a plain object,
// "toString" and "valueOf" read back functions nobody stored.
const PROTOTYPE_NAMES = ["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__"];

describe("parseFoldersMeta / folderEntry", () => {
  it("is empty for nothing stored", () => {
    expect(Object.keys(parseFoldersMeta(null))).toEqual([]);
    expect(Object.keys(parseFoldersMeta(""))).toEqual([]);
  });
  it("reads entries and ignores a value that is not a map of entries", () => {
    const meta = parseFoldersMeta(JSON.stringify({ Taxes: { visibility: "adults" }, junk: 3, list: [] }));
    expect(folderEntry(meta, "Taxes")).toEqual({ visibility: "adults" });
    expect(Object.keys(meta)).toEqual(["Taxes"]);
    expect(Object.keys(parseFoldersMeta("[1,2]"))).toEqual([]);
  });
  it("throws on a stored value it cannot parse — unreadable is not empty", () => {
    expect(() => parseFoldersMeta("{not json")).toThrow();
  });
  it("never answers with something inherited", () => {
    const meta = parseFoldersMeta("{}");
    for (const name of PROTOTYPE_NAMES) {
      expect(meta[name], name).toBeUndefined();
      expect(folderEntry(meta, name), name).toBeUndefined();
      expect(folderEntry({}, name), name).toBeUndefined(); // a plain object too
    }
  });
  it("stores and serializes a folder named like a prototype member", () => {
    const meta = parseFoldersMeta(JSON.stringify({ toString: { visibility: "adults" } }));
    expect(folderEntry(meta, "toString")).toEqual({ visibility: "adults" });
    meta.valueOf = { visibility: "everyone" };
    expect(JSON.parse(JSON.stringify(meta))).toEqual({ toString: { visibility: "adults" }, valueOf: { visibility: "everyone" } });
  });
});

describe("buildFolderList", () => {
  it("merges metadata and document folders, counts, and sorts by name", () => {
    const meta = parseFoldersMeta(JSON.stringify({ Taxes: { visibility: "adults" }, Empty: { visibility: "everyone" } }));
    const docs = [{ folder: "Taxes" }, { folder: "Taxes" }, { folder: "School" }, { folder: null }, {}];
    expect(buildFolderList(docs, meta)).toEqual([
      { name: "Empty", visibility: "everyone", doc_count: 0 },
      { name: "School", visibility: "everyone", doc_count: 1 },
      { name: "Taxes", visibility: "adults", doc_count: 2 },
    ]);
  });
  it("counts folders named like prototype members as numbers", () => {
    const docs = PROTOTYPE_NAMES.flatMap((name) => [{ folder: name }, { folder: name }]);
    for (const meta of [parseFoldersMeta("{}"), {}]) {
      const list = buildFolderList(docs, meta);
      expect(list.map((f) => f.name).sort()).toEqual([...PROTOTYPE_NAMES].sort());
      for (const f of list) {
        expect(f.doc_count, f.name).toBe(2);
        expect(f.visibility, f.name).toBe("everyone");
      }
    }
  });
});

describe("buildFolderList without a readable record", () => {
  // A child in a group is not served the private folder records.
  it("takes a folder's visibility from its documents when they all agree", () => {
    const docs = [
      { folder: "Scouts", sharedWith: ["g1"] }, { folder: "Scouts", sharedWith: ["g1"] },
      { folder: "Mixed", sharedWith: ["g1"] }, { folder: "Mixed", sharedWith: ["everyone"] },
      { folder: "Two", sharedWith: ["g1", "g2"] },
      { folder: "Bare" },
    ];
    expect(buildFolderList(docs, parseFoldersMeta(null))).toEqual([
      { name: "Bare", visibility: "everyone", doc_count: 1 },
      { name: "Mixed", visibility: "everyone", doc_count: 2 },
      { name: "Scouts", visibility: "g1", doc_count: 2 },
      { name: "Two", visibility: "everyone", doc_count: 1 },
    ]);
  });
  it("lets the record stand over the documents", () => {
    const meta = parseFoldersMeta(JSON.stringify({ Taxes: { visibility: "adults" }, Bare: {} }));
    const docs = [{ folder: "Taxes", sharedWith: ["everyone"] }, { folder: "Bare", sharedWith: ["adults"] }];
    expect(buildFolderList(docs, meta).map((f) => [f.name, f.visibility]))
      .toEqual([["Bare", "everyone"], ["Taxes", "adults"]]);
  });
});

describe("folder stores", () => {
  const stores = (open, locked) => ({
    open: parseFoldersMeta(JSON.stringify(open)), locked: parseFoldersMeta(JSON.stringify(locked)),
  });
  const adults = { visibility: "adults", createdBy: "m1" };
  const everyone = { visibility: "everyone", createdBy: "m1" };
  const group = { visibility: "g1", createdBy: "m1" };

  it("records only folders shared with everyone under the open key", () => {
    expect(folderStoreKey("everyone")).toBe(OPEN_FOLDERS_KEY);
    expect(folderStoreKey(undefined)).toBe(OPEN_FOLDERS_KEY);
    expect(folderStoreKey("adults")).toBe(PRIVATE_FOLDERS_KEY);
    expect(folderStoreKey("g1")).toBe(PRIVATE_FOLDERS_KEY);
  });

  it("merges both stores, the private entry standing where a name is in both", () => {
    const meta = mergeFolderStores(stores({ School: everyone, Medical: everyone }, { Medical: adults, toString: adults }));
    expect(Object.keys(meta).sort()).toEqual(["Medical", "School", "toString"]);
    expect(meta.Medical).toEqual(adults);
    expect(folderEntry(meta, "constructor")).toBeUndefined();
    expect(mergeFolderStores({})).toEqual({});
  });

  it("creates a folder under the key its visibility calls for", () => {
    expect(planFolderWrites(stores({}, {}), [{ name: "Medical", entry: adults }])).toEqual([
      { key: PRIVATE_FOLDERS_KEY, ops: [{ op: "set", path: "Medical", value: adults }], value: { Medical: adults } },
    ]);
    expect(planFolderWrites(stores({}, {}), [{ name: "School", entry: everyone }])).toEqual([
      { key: OPEN_FOLDERS_KEY, ops: [{ op: "set", path: "School", value: everyone }], value: { School: everyone } },
    ]);
  });

  it("renames within one key in a single write", () => {
    const writes = planFolderWrites(stores({ Other: everyone }, { Medical: adults }), [
      { name: "Health", entry: adults }, { name: "Medical", entry: null },
    ]);
    expect(writes).toEqual([{
      key: PRIVATE_FOLDERS_KEY,
      ops: [{ op: "set", path: "Health", value: adults }, { op: "delete", path: "Medical" }],
      value: { Health: adults },
    }]);
  });

  // Whichever way a folder moves, the key that gains it is written first: if
  // the second write fails the folder is recorded twice, never not at all.
  it("writes the gaining key first when a folder is locked", () => {
    const writes = planFolderWrites(stores({ Medical: everyone, School: everyone }, {}), [{ name: "Medical", entry: adults }]);
    expect(writes).toEqual([
      { key: PRIVATE_FOLDERS_KEY, ops: [{ op: "set", path: "Medical", value: adults }], value: { Medical: adults } },
      { key: OPEN_FOLDERS_KEY, ops: [{ op: "delete", path: "Medical" }], value: { School: everyone } },
    ]);
  });
  it("writes the gaining key first when a folder is opened up", () => {
    const writes = planFolderWrites(stores({}, { Medical: adults, Taxes: adults }), [{ name: "Medical", entry: everyone }]);
    expect(writes.map((w) => [w.key, w.ops.map((op) => op.op)])).toEqual([
      [OPEN_FOLDERS_KEY, ["set"]], [PRIVATE_FOLDERS_KEY, ["delete"]],
    ]);
    expect(writes[1].value).toEqual({ Taxes: adults });
  });

  it("renames and re-shares at once, clearing the old name from both keys", () => {
    const writes = planFolderWrites(stores({ Medical: everyone }, { Medical: adults }), [
      { name: "Health", entry: group }, { name: "Medical", entry: null },
    ]);
    expect(writes).toEqual([
      { key: PRIVATE_FOLDERS_KEY, ops: [{ op: "set", path: "Health", value: group }, { op: "delete", path: "Medical" }], value: { Health: group } },
      { key: OPEN_FOLDERS_KEY, ops: [{ op: "delete", path: "Medical" }], value: {} },
    ]);
  });

  it("deletes a folder from wherever it is recorded, and writes nothing for one that is not", () => {
    expect(planFolderWrites(stores({ School: everyone }, {}), [{ name: "School", entry: null }]))
      .toEqual([{ key: OPEN_FOLDERS_KEY, ops: [{ op: "delete", path: "School" }], value: {} }]);
    expect(planFolderWrites(stores({ School: everyone }, {}), [{ name: "Gone", entry: null }])).toEqual([]);
  });

  it("does not take a prototype member for a recorded folder", () => {
    expect(planFolderWrites(stores({}, {}), [{ name: "toString", entry: null }])).toEqual([]);
    expect(planFolderWrites({ open: {}, locked: {} }, [{ name: "toString", entry: null }])).toEqual([]);
  });

  it("leaves the stores it was given untouched", () => {
    const before = stores({ Medical: everyone }, {});
    planFolderWrites(before, [{ name: "Medical", entry: adults }]);
    expect(before.open.Medical).toEqual(everyone);
    expect(Object.keys(before.locked)).toEqual([]);
  });

  describe("planFolderMigration", () => {
    it("moves every folder that is not for everyone out of the open key, private key first", () => {
      const writes = planFolderMigration(stores({ School: everyone, Medical: adults, Scouts: group, Bare: {} }, { Taxes: adults }));
      expect(writes).toEqual([
        {
          key: PRIVATE_FOLDERS_KEY,
          ops: [{ op: "set", path: "Medical", value: adults }, { op: "set", path: "Scouts", value: group }],
          value: { Taxes: adults, Medical: adults, Scouts: group },
        },
        {
          key: OPEN_FOLDERS_KEY,
          ops: [{ op: "delete", path: "Medical" }, { op: "delete", path: "Scouts" }],
          value: { School: everyone, Bare: {} },
        },
      ]);
    });
    it("clears a name left in both keys, keeping the private record", () => {
      const writes = planFolderMigration(stores({ Medical: everyone }, { Medical: adults }));
      expect(writes).toEqual([
        { key: PRIVATE_FOLDERS_KEY, ops: [{ op: "set", path: "Medical", value: adults }], value: { Medical: adults } },
        { key: OPEN_FOLDERS_KEY, ops: [{ op: "delete", path: "Medical" }], value: {} },
      ]);
    });
    it("has nothing to do once the stores are split, or empty", () => {
      expect(planFolderMigration(stores({ School: everyone, Bare: {} }, { Medical: adults }))).toEqual([]);
      expect(planFolderMigration(stores({}, {}))).toEqual([]);
      expect(planFolderMigration({})).toEqual([]);
    });
  });
});

describe("visibilityKind / visibleFolders", () => {
  const groups = [{ id: "g1", name: "Board", memberIds: ["m1"] }];
  const all = [
    { name: "Open", visibility: "everyone" },
    { name: "Grown-ups", visibility: "adults" },
    { name: "Board", visibility: "g1" },
    { name: "Orphaned", visibility: "g-gone" },
  ];
  const names = (who) => visibleFolders(all, { groups, ...who }).map((f) => f.name);

  it("names what a visibility means", () => {
    expect(visibilityKind("everyone", groups)).toBe("everyone");
    expect(visibilityKind("adults", groups)).toBe("adults");
    expect(visibilityKind("g1", groups)).toBe("group");
    expect(visibilityKind("g-gone", groups)).toBe("missing");
    expect(visibilityKind("g1", undefined)).toBe("missing");
  });
  it("shows a child only what is for everyone, and a group they are in", () => {
    expect(names({ isAdult: false, memberId: "kid" })).toEqual(["Open"]);
    expect(names({ isAdult: false, memberId: "m1" })).toEqual(["Open", "Board"]);
  });
  it("hides a group folder from an adult outside the group", () => {
    expect(names({ isAdult: true, memberId: "m2" })).toEqual(["Open", "Grown-ups", "Orphaned"]);
  });
  it("shows adults a folder whose group is gone, so it can be given a new visibility", () => {
    expect(names({ isAdult: true, memberId: "m1" })).toEqual(["Open", "Grown-ups", "Board", "Orphaned"]);
    expect(names({ isAdult: false, memberId: undefined })).toEqual(["Open"]);
  });
});

describe("folderNameTaken", () => {
  const meta = parseFoldersMeta(JSON.stringify({ Taxes: { visibility: "adults" } }));
  const folders = [{ name: "School" }];
  it("is true for a name in the metadata or among the folders shown", () => {
    expect(folderNameTaken("Taxes", meta, folders)).toBe(true);  // may be hidden from this person
    expect(folderNameTaken("School", meta, folders)).toBe(true); // exists only through its documents
  });
  it("is false for a new name, compared exactly as folders are", () => {
    expect(folderNameTaken("Receipts", meta, folders)).toBe(false);
    expect(folderNameTaken("taxes", meta, folders)).toBe(false);
    expect(folderNameTaken("toString", meta, folders)).toBe(false);
  });
});

// A document is filed under the folder's visibility as it is NOW. The tab's
// own copy may be hours old.
describe("resolveVisibility", () => {
  const meta = parseFoldersMeta(JSON.stringify({ Medical: { visibility: "adults" }, Bare: {} }));
  it("takes the stored visibility over the tab's copy", () => {
    expect(resolveVisibility(meta, { name: "Medical", visibility: "everyone" })).toBe("adults");
  });
  it("treats an entry with no visibility as everyone, as the folder list does", () => {
    expect(resolveVisibility(meta, { name: "Bare", visibility: "everyone" })).toBe("everyone");
  });
  it("keeps everyone for a folder that only ever existed through its documents", () => {
    expect(resolveVisibility(meta, { name: "Legacy", visibility: "everyone" })).toBe("everyone");
  });
  it("refuses when a protected folder is no longer recorded", () => {
    expect(resolveVisibility(meta, { name: "Gone", visibility: "adults" })).toBeNull();
    expect(resolveVisibility(meta, { name: "Gone", visibility: "g1" })).toBeNull();
    expect(resolveVisibility(meta, { name: "toString", visibility: "adults" })).toBeNull();
  });
});

// Mirrors the hub: a document is changed by its owner or an admin.
describe("canChangeDoc", () => {
  const doc = { id: "d1", ownerId: "m1" };
  it("allows the owner and an admin", () => {
    expect(canChangeDoc(doc, { canWrite: true, isAdmin: false, memberId: "m1" })).toBe(true);
    expect(canChangeDoc(doc, { canWrite: true, isAdmin: true, memberId: "m2" })).toBe(true);
    expect(canChangeDoc(doc, { canWrite: true, isAdmin: true, memberId: undefined })).toBe(true);
  });
  it("refuses another adult", () => {
    expect(canChangeDoc(doc, { canWrite: true, isAdmin: false, memberId: "m2" })).toBe(false);
    expect(canChangeDoc({ id: "d2" }, { canWrite: true, isAdmin: false, memberId: undefined })).toBe(false);
  });
  it("refuses anyone who may not write at all, owner included", () => {
    expect(canChangeDoc(doc, { canWrite: false, isAdmin: false, memberId: "m1" })).toBe(false);
    expect(canChangeDoc(doc, { canWrite: false, isAdmin: true, memberId: "m1" })).toBe(false);
  });
});

// ── folderListHtml ────────────────────────────────────────────────────────────
// A folder name used to be written into onclick="selectFolder('…')". HTML
// escaping does not survive there: the parser turns &#39; back into a quote
// before the handler is compiled, so "Mom's Records" could not be opened and
// a crafted name ran as script. Names now travel as data.
describe("folderListHtml", () => {
  // The hub SDK's esc, which is what index.html passes in.
  const esc = (str) => String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const unesc = (str) => str
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  const glyph = (name) => `<svg data-glyph="${name}"></svg>`;
  const render = (folders, opts = {}) => folderListHtml(folders, { groups: [], esc, glyph, ...opts });
  const HOSTILE = [
    "Mom's Records",
    "x');window.pwned=1;//",
    "trailing\\",
    'say "hi"',
    '"><img src=x onerror=alert(1)>',
    "<script>alert(1)</script>",
    "a & b",
  ];

  it("carries every name as data and round-trips it exactly", () => {
    for (const name of HOSTILE) {
      const html = render([{ name, visibility: "everyone", doc_count: 1 }]);
      const attr = html.match(/data-folder="([^"]*)"/);
      expect(attr, name).not.toBeNull();
      expect(unesc(attr[1]), name).toBe(name);
    }
  });

  it("writes no inline handler and no markup of the name's own", () => {
    for (const name of HOSTILE) {
      const html = render([{ name, visibility: "everyone", doc_count: 1 }]);
      // With the glyphs and the row's own tags removed, nothing tag-like or
      // handler-like may be left: whatever remains came from the name.
      const stripped = html.replace(/<svg data-glyph="[a-z]+"><\/svg>/g, "").replace(/<\/?(div|span)[^<>]*>/g, "");
      expect(stripped, name).not.toMatch(/[<>]/);
      expect(html, name).not.toMatch(/onclick|selectFolder\(/);
      expect(html.match(/<div class="folder-item/g), name).toHaveLength(1);
    }
  });

  it("marks the open folder, adults-only, a group and a removed group", () => {
    const groups = [{ id: "g1", name: 'The "Board"', memberIds: [] }];
    const html = render([
      { name: "Open", visibility: "everyone", doc_count: 0 },
      { name: "Grown-ups", visibility: "adults", doc_count: 2 },
      { name: "Board", visibility: "g1", doc_count: 3 },
      { name: "Orphaned", visibility: "g-gone", doc_count: 1 },
    ], { groups, currentName: "Board" });
    expect(html.match(/folder-item active/g)).toHaveLength(1);
    expect(html).toMatch(/folder-item active" data-folder="Board"/);
    expect(html).toContain('title="Adults only"');
    expect(html).toContain('title="Group: The &quot;Board&quot;"');
    expect(html).toContain('title="Shared with a group that no longer exists"');
    expect(html.match(/folder-lock/g)).toHaveLength(3);
  });
});

describe("outcomeUnknown", () => {
  it("is unknown with no answer, a 400, or a 5xx other than 507", () => {
    for (const status of [undefined, 0, 200, 400, 500, 502, 503]) expect(outcomeUnknown({ status })).toBe(true);
    expect(outcomeUnknown(new Error("network"))).toBe(true);
  });
  it("is a known refusal for any other 4xx and for 507", () => {
    for (const status of [403, 404, 409, 413, 415, 429, 507]) expect(outcomeUnknown({ status })).toBe(false);
  });
});

describe("sameFile", () => {
  const f = { name: "a.pdf", size: 10, type: "application/pdf", lastModified: 5 };
  it("matches the same file picked again", () => expect(sameFile(f, { ...f })).toBe(true));
  it("tells another file apart", () => {
    expect(sameFile(f, { ...f, size: 11 })).toBe(false);
    expect(sameFile(f, { ...f, name: "b.pdf" })).toBe(false);
    expect(sameFile(f, { ...f, lastModified: 6 })).toBe(false);
    expect(sameFile(null, f)).toBe(false);
  });
});

describe("docForFile", () => {
  it("finds the document naming the stored file", () => {
    expect(docForFile([{ id: "d1", fileKey: "f1" }, { id: "d2", fileKey: "f2" }], "f2")?.id).toBe("d2");
  });
  it("is null when no document names it", () => {
    expect(docForFile([{ id: "d1", fileKey: "f1" }], "f9")).toBeNull();
    expect(docForFile(undefined, "f1")).toBeNull();
  });
});
