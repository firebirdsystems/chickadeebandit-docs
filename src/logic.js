// Shared utilities (memberColor, initial, esc, isAdult, formatRelativeDate) live in /hub-sdk.js.
// This file exports docs-specific logic only.

export const ALLOWED_EXTENSIONS = {
  "image/jpeg":        { ext: "jpg",  label: "JPEG",  glyph: "frame" },
  "image/png":         { ext: "png",  label: "PNG",   glyph: "frame" },
  "image/heic":        { ext: "heic", label: "HEIC",  glyph: "frame" },
  "image/heif":        { ext: "heif", label: "HEIF",  glyph: "frame" },
  "image/webp":        { ext: "webp", label: "WebP",  glyph: "frame" },
  "image/gif":         { ext: "gif",  label: "GIF",   glyph: "frame" },
  "application/pdf":   { ext: "pdf",  label: "PDF",   glyph: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                       { ext: "docx", label: "Word",  glyph: "note" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                       { ext: "xlsx", label: "Excel", glyph: "poll-bars" },
  "text/plain":        { ext: "txt",  label: "Text",  glyph: "note" },
  "text/markdown":     { ext: "md",   label: "Markdown", glyph: "note" },
};

export function isImage(mimeType) {
  return mimeType?.startsWith("image/") === true;
}

export function isPreviewableImage(mimeType) {
  return isImage(mimeType) && mimeType !== "image/heic" && mimeType !== "image/heif";
}

export function isPdf(mimeType) {
  return mimeType === "application/pdf";
}

/** The name of the hub glyph that marks a file type — drawn with the SDK's glyph(). */
export function fileGlyph(mimeType) {
  return ALLOWED_EXTENSIONS[mimeType]?.glyph ?? "document";
}

export function formatBytes(bytes) {
  if (bytes < 1024)             return `${bytes} B`;
  if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function accept() {
  return Object.keys(ALLOWED_EXTENSIONS).join(",");
}

/**
 * Whether a folder name can address itself as a store-patch path segment.
 * `folders_meta` is a JSON map keyed by folder name, and targeted edits go
 * through PATCH /api/store, whose paths are dot-separated: a dot in the name
 * would address a nested object, an over-long one is refused, and the
 * prototype keys are refused outright. Names failing this fall back to the
 * whole-blob write, which is racy — so new names are held to it.
 */
const FORBIDDEN_FOLDER_NAMES = new Set(["__proto__", "prototype", "constructor"]);
export const MAX_FOLDER_NAME_LENGTH = 64;
export function folderPathSafe(name) {
  return typeof name === "string"
    && name.length > 0
    && name.length <= MAX_FOLDER_NAME_LENGTH
    && !name.includes(".")
    && !FORBIDDEN_FOLDER_NAMES.has(name);
}

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`). The
 * mime type is included so "pdf" or "image" finds files by kind — a document
 * library is browsed by type at least as often as by name.
 */
export function searchableFields(doc) {
  return [doc.title, doc.mimeType];
}

// ── Paged document reads ───────────────────────────────────────────────────────
/** The largest page the hub's document list will serve. */
export const DOCS_PAGE_LIMIT = 100;

/**
 * Reads a document list to its end. The hub serves it in pages (50 by default,
 * newest first) and says whether more follow, so a single read is only the
 * newest part of a long folder — and a rename, a visibility change or a folder
 * delete built on one page silently covers just that part.
 *
 * `fetchPage(cursor)` reads one page and resolves `{ docs, nextCursor }`, with
 * `nextCursor` null on the last page. It must THROW when the read fails: a
 * failed read is not an empty folder, and every caller here acts on the result.
 */
export async function fetchAllDocs(fetchPage, { maxPages = 500 } = {}) {
  const all = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const { docs, nextCursor } = await fetchPage(cursor);
    if (!Array.isArray(docs)) throw new Error("Unexpected response reading documents");
    all.push(...docs);
    if (!nextCursor) return all;
    // A cursor that repeats would loop forever on a list that never ends.
    if (seen.has(nextCursor)) throw new Error("Document list did not advance");
    seen.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error("Too many documents to read");
}

// ── Folders ────────────────────────────────────────────────────────────────────
/**
 * `folders_meta` as a map with no prototype. Folder names are its keys and are
 * chosen by people, so on a plain object a folder called "toString" would read
 * back a function it never stored.
 */
export function parseFoldersMeta(value) {
  const meta = Object.create(null);
  if (!value) return meta;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return meta;
  for (const [name, entry] of Object.entries(parsed)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) meta[name] = entry;
  }
  return meta;
}

/** A folder's own metadata entry, never something inherited from a prototype. */
export function folderEntry(meta, name) {
  return meta && Object.hasOwn(meta, name) ? meta[name] : undefined;
}

// Folder metadata lives under two store keys, split by who may read the key.
// Folders shared with everyone are recorded in `folders_meta`, which anyone in
// the household can read. Every other folder — adults only, or shared with a
// group — is recorded in `folders_private`, which the hub serves to adults
// only: the name of a folder a child may not open ("Divorce", "Therapy") says
// something by itself, so it is not kept where a child's session can read it.
export const OPEN_FOLDERS_KEY = "folders_meta";
export const PRIVATE_FOLDERS_KEY = "folders_private";

/** The store key a folder with this visibility is recorded under. */
export function folderStoreKey(visibility) {
  return visibility === "everyone" || visibility == null ? OPEN_FOLDERS_KEY : PRIVATE_FOLDERS_KEY;
}

/**
 * Both stores as one map. Where a name is in both — a write to one key landed
 * and the write to the other did not — the private entry stands, so a folder
 * is never shown as more open than its record says.
 */
export function mergeFolderStores({ open, locked }) {
  const meta = Object.create(null);
  for (const [name, entry] of Object.entries(open ?? {})) meta[name] = entry;
  for (const [name, entry] of Object.entries(locked ?? {})) meta[name] = entry;
  return meta;
}

/**
 * The store writes that carry out `changes`, in the order to send them.
 * A change is `{ name, entry }`: record the folder under the key its
 * visibility calls for and take it out of the other one, or, with a null
 * entry, take it out of both.
 *
 * Each write is `{ key, ops, value }`: the patch ops for that key, and the
 * whole map as it will stand afterwards, for names that cannot be addressed
 * as a patch path. A key that gains a folder is written before a key that
 * only loses one, so a failure in between leaves the folder recorded twice
 * (the private entry stands) and never not at all.
 */
export function planFolderWrites(stores, changes) {
  // Copies, and with no prototype: folder names are their keys.
  const copy = (map) => Object.assign(Object.create(null), map);
  const maps = {
    [OPEN_FOLDERS_KEY]: copy(stores?.open),
    [PRIVATE_FOLDERS_KEY]: copy(stores?.locked),
  };
  const ops = { [OPEN_FOLDERS_KEY]: [], [PRIVATE_FOLDERS_KEY]: [] };
  for (const { name, entry } of changes) {
    const target = entry ? folderStoreKey(entry.visibility) : null;
    for (const key of Object.keys(maps)) {
      if (key === target) {
        maps[key][name] = entry;
        ops[key].push({ op: "set", path: name, value: entry });
      } else if (Object.hasOwn(maps[key], name)) {
        delete maps[key][name];
        ops[key].push({ op: "delete", path: name });
      }
    }
  }
  const gains = (key) => ops[key].some((op) => op.op === "set");
  return Object.keys(maps)
    .filter((key) => ops[key].length > 0)
    .sort((a, b) => Number(gains(b)) - Number(gains(a)))
    .map((key) => ({ key, ops: ops[key], value: maps[key] }));
}

/**
 * The writes that move every folder that is not shared with everyone out of
 * the open key — where all of them were once kept — and into the private one.
 * Also clears a name left in both by a write that only half landed. Empty when
 * there is nothing to move, which is every load after the first.
 */
export function planFolderMigration(stores) {
  const open = stores?.open ?? {};
  const locked = stores?.locked ?? {};
  const changes = [];
  for (const [name, entry] of Object.entries(open)) {
    const shadowed = Object.hasOwn(locked, name);
    if (!shadowed && folderStoreKey(entry?.visibility) === OPEN_FOLDERS_KEY) continue;
    changes.push({ name, entry: shadowed ? locked[name] : entry });
  }
  return planFolderWrites(stores, changes);
}

/**
 * Who a folder's documents are shared with, when they all agree: the one
 * `sharedWith` value every one of them carries. Null when there are none, or
 * they differ, or any is shared some other way.
 */
function sharedVisibility(docs) {
  let found = null;
  for (const d of docs) {
    if (!Array.isArray(d.sharedWith) || d.sharedWith.length !== 1) return null;
    if (found !== null && d.sharedWith[0] !== found) return null;
    found = d.sharedWith[0];
  }
  return found;
}

/**
 * Every folder — from the metadata and from the documents — with its count, by
 * name. A folder with no metadata this person can read takes its visibility
 * from its documents: a child in a group is not served the private folder
 * records, and still sees the group's folder marked as the group's.
 */
export function buildFolderList(docs, meta) {
  const inFolder = new Map();
  for (const d of docs) {
    if (!d.folder) continue;
    if (!inFolder.has(d.folder)) inFolder.set(d.folder, []);
    inFolder.get(d.folder).push(d);
  }
  const names = new Set([...Object.keys(meta ?? {}), ...inFolder.keys()]);
  return [...names].map((name) => {
    const held = inFolder.get(name) ?? [];
    const entry = folderEntry(meta, name);
    return {
      name,
      visibility: entry ? entry.visibility ?? "everyone" : sharedVisibility(held) ?? "everyone",
      doc_count: held.length,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a folder's visibility means to the person looking: "everyone", "adults",
 * "group" (a group that exists) or "missing" (a group id nothing answers to any
 * more — the group was removed, or the groups could not be read).
 */
export function visibilityKind(visibility, groups) {
  if (visibility === "everyone" || visibility === "adults") return visibility;
  return (groups ?? []).some((g) => g.id === visibility) ? "group" : "missing";
}

/**
 * The folders this person is shown. A folder whose group is gone is shown to
 * adults, so someone can open it and give it a visibility that still exists;
 * the hub goes on deciding who may read each document inside.
 */
export function visibleFolders(all, { isAdult, memberId, groups }) {
  return all.filter((f) => {
    const kind = visibilityKind(f.visibility, groups);
    if (kind === "everyone") return true;
    if (kind === "group") return groups.find((g) => g.id === f.visibility).memberIds.includes(memberId);
    return isAdult;
  });
}

/** Whether a name is already a folder — in the metadata or among the folders shown. */
export function folderNameTaken(name, meta, folders) {
  return folderEntry(meta, name) !== undefined || (folders ?? []).some((f) => f.name === name);
}

/**
 * The visibility a document filed in `folder` should carry NOW, from metadata
 * just read — not from what this tab loaded earlier, which another adult may
 * have changed since. Null means the folder this tab knew is gone or was never
 * recorded with the protection the tab believes it has, so nothing is filed.
 */
export function resolveVisibility(meta, folder) {
  const entry = folderEntry(meta, folder.name);
  if (entry) return entry.visibility ?? "everyone";
  return folder.visibility === "everyone" ? "everyone" : null;
}

/**
 * Whether the hub will accept this person's rename, move or delete of a
 * document: its owner or an admin, and never someone who may not write at all.
 */
export function canChangeDoc(doc, { canWrite, isAdmin, memberId }) {
  return canWrite === true && (isAdmin === true || (!!memberId && doc?.ownerId === memberId));
}

/**
 * The sidebar's folder rows. Names travel in `data-folder` and are read back
 * by one delegated listener: a name is never written into script, where the
 * HTML escaping that protects an attribute is undone before the code is parsed.
 * `esc` and `glyph` are the hub SDK's, passed in so this stays importable.
 */
export function folderListHtml(folders, { currentName, groups, esc, glyph }) {
  return folders.map((f) => {
    const kind = visibilityKind(f.visibility, groups);
    const mark = kind === "adults" ? `<span class="folder-lock" title="Adults only">${glyph("lock")}</span>`
      : kind === "group" ? `<span class="folder-lock" title="Group: ${esc(groups.find((g) => g.id === f.visibility).name)}">${glyph("people")}</span>`
      : kind === "missing" ? `<span class="folder-lock" title="Shared with a group that no longer exists">${glyph("lock")}</span>`
      : "";
    return `
      <div class="folder-item ${currentName === f.name ? "active" : ""}" data-folder="${esc(f.name)}">
        <span class="folder-icon">${glyph("folder")}</span>
        <span class="folder-name">${esc(f.name)}</span>
        ${mark}
        <span class="folder-count">${f.doc_count ?? 0}</span>
      </div>`;
  }).join("");
}

/**
 * Whether a failed write may nonetheless have been stored ("retry after a lost
 * response"). No status: the request threw before any answer. A 400: the hub's
 * answer for a write that timed out after it may have been stored. A 5xx other
 * than 507: the hub failing on its side, possibly after the write. Anything
 * else (403, 404, 409, 413, 415, 429, 507, …) is a refusal that stored nothing.
 */
export function outcomeUnknown(e) {
  const status = Number(e?.status) || 0;
  // Up to 400: no answer, a 2xx whose body could not be read as a result, or a 400.
  return status <= 400 || (status >= 500 && status !== 507);
}

/** Whether two picks are the same file: a File picked again is a new object. */
export function sameFile(a, b) {
  return !!a && !!b && a.name === b.name && a.size === b.size
    && a.type === b.type && a.lastModified === b.lastModified;
}

/** The document among `docs` that names the stored file `fileKey`, if any. */
export function docForFile(docs, fileKey) {
  return (docs ?? []).find((d) => d?.fileKey === fileKey) ?? null;
}

/**
 * The line a failed write shows ("Refused, gone, or failed" in the app-template
 * guide): "try again" only when retrying can work, and never the hub's text.
 * `thing` and `action` are the app's own nouns. `found` is the caller's re-read
 * after a write that changed nothing: false = the row is gone, true = it is
 * still there (on a plain `WHERE id = ?` write the row policy narrowed it, the
 * permission line; on a `guarded` write its state moved), null = the re-read
 * itself failed. A `forUser` error keeps the message the app wrote for it.
 */
export function failureLine(e, { action, thing, found, guarded = false } = {}) {
  if (e?.forUser) return e.message;
  if (e?.code === "UNIQUE_CONSTRAINT" || /UNIQUE constraint failed/i.test(String(e?.message ?? ""))) return `That ${thing} already exists.`;
  if (e?.status === 403 || (found === true && !guarded)) return `You don’t have permission to ${action}.`;
  if (e?.status === 507) return "The household’s storage is full — free up space first.";
  if (e?.status === 429) return "Too many tries — wait a minute and try again.";
  if (found === null) return `Couldn’t ${action} — try again.`;
  if (found === false || (found === undefined && e?.status === 404)) return `This ${thing} has been removed.`;
  if (found === true || e?.status === 409) return `This ${thing} was changed by someone else — check it first.`;
  return `Couldn’t ${action} — try again.`;
}

/**
 * The line a failed upload shows. The hub's two refusals of the file itself get
 * a line of their own: 413 too large, 415 a type it does not take. The rest
 * (403, 429, 507, no answer or a 5xx) follows `failureLine`.
 */
export function uploadFailureLine(e, words) {
  if (e?.status === 413) return "That file is too large.";
  if (e?.status === 415) return "That kind of file can’t be uploaded.";
  return failureLine(e, words);
}
