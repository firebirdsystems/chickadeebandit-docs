// Shared utilities (memberColor, initial, esc, isAdult, formatRelativeDate) live in /hub-sdk.js.
// This file exports docs-specific logic only.

export const ALLOWED_EXTENSIONS = {
  "image/jpeg":        { ext: "jpg",  label: "JPEG",  icon: "🖼️" },
  "image/png":         { ext: "png",  label: "PNG",   icon: "🖼️" },
  "image/heic":        { ext: "heic", label: "HEIC",  icon: "🖼️" },
  "image/heif":        { ext: "heif", label: "HEIF",  icon: "🖼️" },
  "image/webp":        { ext: "webp", label: "WebP",  icon: "🖼️" },
  "image/gif":         { ext: "gif",  label: "GIF",   icon: "🖼️" },
  "application/pdf":   { ext: "pdf",  label: "PDF",   icon: "📄" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                       { ext: "docx", label: "Word",  icon: "📝" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                       { ext: "xlsx", label: "Excel", icon: "📊" },
  "text/plain":        { ext: "txt",  label: "Text",  icon: "📃" },
  "text/markdown":     { ext: "md",   label: "Markdown", icon: "📃" },
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

export function fileIcon(mimeType) {
  return ALLOWED_EXTENSIONS[mimeType]?.icon ?? "📎";
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
