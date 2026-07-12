// Tiny vanilla-JS file browser for the /api/files app. No build step, no
// framework — this is meant to stay easy to read alongside the Rust side.

const API_BASE = "/api/files";
const TOKEN_KEY = "home-server-token";
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

let currentPath = ""; // relative path, "" = root
let draggedEntryPath = null; // set while an internal row-drag is in progress

const breadcrumbEl = document.getElementById("breadcrumb");
const listingBodyEl = document.getElementById("listing-body");
const emptyStateEl = document.getElementById("empty-state");
const statusEl = document.getElementById("status-text");
const dropzoneEl = document.getElementById("dropzone");
const fileInputEl = document.getElementById("file-input");
const folderInputEl = document.getElementById("folder-input");
const newFolderBtn = document.getElementById("new-folder-btn");
const upBtn = document.getElementById("up-btn");

init();

function init() {
  newFolderBtn.addEventListener("click", onNewFolder);
  upBtn.addEventListener("click", () => {
    if (!currentPath) return;
    currentPath = parentOf(currentPath);
    refresh();
  });

  fileInputEl.addEventListener("change", () => {
    uploadEntries(entriesFromFileList(fileInputEl.files));
    fileInputEl.value = "";
  });
  folderInputEl.addEventListener("change", () => {
    uploadEntries(entriesFromFileList(folderInputEl.files));
    folderInputEl.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      if (!draggedEntryPath) dropzoneEl.classList.add("dragover");
    })
  );
  ["dragleave"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove("dragover");
    })
  );
  dropzoneEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzoneEl.classList.remove("dragover");
    if (draggedEntryPath) return; // an internal row/crumb drop already handled this

    const entries = await collectFromDataTransfer(e.dataTransfer);
    uploadEntries(entries);
  });

  refresh();
}

// --- API helpers -----------------------------------------------------

async function api(path, opts = {}) {
  const headers = opts.headers ? { ...opts.headers } : {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });

  if (res.status === 401) {
    const entered = prompt("This server requires an access token:");
    if (entered) {
      localStorage.setItem(TOKEN_KEY, entered);
      return api(path, opts); // retry once with the new token
    }
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      /* body wasn't JSON, statusText is fine */
    }
    throw new Error(message);
  }

  return res;
}

// --- rendering ---------------------------------------------------------

async function refresh() {
  setStatus("loading…");
  upBtn.disabled = !currentPath;
  try {
    const res = await api(`${API_BASE}?path=${encodeURIComponent(currentPath)}`);
    const data = await res.json();
    renderBreadcrumb(data.path);
    renderListing(data.entries);
    setStatus(`${data.entries.length} item${data.entries.length === 1 ? "" : "s"}`);
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

function renderBreadcrumb(path) {
  breadcrumbEl.innerHTML = "";

  const rootBtn = crumbButton("~", "");
  breadcrumbEl.appendChild(rootBtn);

  const parts = path.split("/").filter(Boolean);
  let acc = "";
  parts.forEach((part) => {
    acc = acc ? `${acc}/${part}` : part;
    breadcrumbEl.appendChild(sep());
    breadcrumbEl.appendChild(crumbButton(part, acc));
  });

  const cursor = document.createElement("span");
  cursor.className = "cursor";
  breadcrumbEl.appendChild(document.createTextNode(" $"));
  breadcrumbEl.appendChild(cursor);
}

function crumbButton(label, path) {
  const btn = document.createElement("button");
  btn.className = "crumb" + (path === currentPath ? " current" : "");
  btn.textContent = label;
  btn.type = "button";
  btn.addEventListener("click", () => {
    currentPath = path;
    refresh();
  });

  btn.addEventListener("dragover", (e) => {
    if (!draggedEntryPath) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    btn.classList.add("drop-target");
  });
  btn.addEventListener("dragleave", () => btn.classList.remove("drop-target"));
  btn.addEventListener("drop", (e) => {
    if (!draggedEntryPath) return;
    e.preventDefault();
    e.stopPropagation();
    btn.classList.remove("drop-target");
    moveIntoDirectory(draggedEntryPath, path);
  });

  return btn;
}

function sep() {
  const s = document.createElement("span");
  s.className = "sep";
  s.textContent = "/";
  return s;
}

function renderListing(entries) {
  listingBodyEl.innerHTML = "";
  emptyStateEl.hidden = entries.length > 0;

  for (const entry of entries) {
    const tr = document.createElement("tr");
    const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

    // Every row can be dragged (to move it) and every folder row can
    // receive a drop (to move something into it).
    tr.draggable = true;
    tr.addEventListener("dragstart", (e) => {
      draggedEntryPath = entryPath;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-home-server-path", entryPath);
    });
    tr.addEventListener("dragend", () => {
      draggedEntryPath = null;
    });

    if (entry.is_dir) {
      tr.addEventListener("dragover", (e) => {
        if (!draggedEntryPath) return; // only react to our own internal drags
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        tr.classList.add("drop-target");
      });
      tr.addEventListener("dragleave", () => tr.classList.remove("drop-target"));
      tr.addEventListener("drop", (e) => {
        if (!draggedEntryPath) return;
        e.preventDefault();
        e.stopPropagation(); // don't also trigger the dropzone's upload handler
        tr.classList.remove("drop-target");
        moveIntoDirectory(draggedEntryPath, entryPath);
      });
    }

    const nameTd = document.createElement("td");
    nameTd.appendChild(entryNameButton(entry));
    tr.appendChild(nameTd);

    const sizeTd = document.createElement("td");
    sizeTd.className = "col-size";
    sizeTd.textContent = entry.is_dir ? "—" : formatBytes(entry.size);
    tr.appendChild(sizeTd);

    const modTd = document.createElement("td");
    modTd.className = "col-modified";
    modTd.textContent = entry.modified ? formatDate(entry.modified) : "—";
    tr.appendChild(modTd);

    const actionsTd = document.createElement("td");
    actionsTd.className = "col-actions";
    actionsTd.appendChild(renameButton(entry));
    actionsTd.appendChild(downloadButton(entry));
    actionsTd.appendChild(deleteButton(entry));
    tr.appendChild(actionsTd);

    listingBodyEl.appendChild(tr);
  }
}

function entryNameButton(entry) {
  const btn = document.createElement("button");
  btn.className = "entry-name" + (entry.is_dir ? " is-dir" : "");
  btn.type = "button";

  const childPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
  const ext = extOf(entry.name);

  if (!entry.is_dir && IMAGE_EXTENSIONS.has(ext)) {
    btn.appendChild(thumbnailImg(childPath));
  } else {
    const icon = document.createElement("span");
    icon.className = "entry-icon";
    icon.textContent = entry.is_dir ? "\u25B8" : "\u2013"; // ▸ or –
    btn.appendChild(icon);
  }
  btn.appendChild(document.createTextNode(entry.name));

  btn.addEventListener("click", () => {
    if (entry.is_dir) {
      currentPath = childPath;
      refresh();
    } else {
      // Open in a new tab — the browser renders it if it can (images, PDF,
      // HTML, ...) and otherwise falls back to its own download handling.
      // The dedicated "download" button is the reliable way to force a save.
      openInNewTab(childPath);
    }
  });

  return btn;
}

function thumbnailImg(path) {
  const img = document.createElement("img");
  img.className = "thumb";
  img.loading = "lazy";
  img.alt = "";
  resolveViewUrl(path)
    .then((src) => {
      img.src = src;
    })
    .catch(() => img.remove());
  return img;
}

function downloadButton(entry) {
  const btn = document.createElement("button");
  btn.className = "row-action";
  btn.type = "button";
  btn.textContent = entry.is_dir ? "download zip" : "download";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const childPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    downloadFile(childPath);
  });
  return btn;
}

function renameButton(entry) {
  const btn = document.createElement("button");
  btn.className = "row-action";
  btn.type = "button";
  btn.textContent = "rename";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const newName = prompt("New name:", entry.name);
    if (!newName || newName === entry.name) return;

    const from = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const to = currentPath ? `${currentPath}/${newName}` : newName;
    try {
      await api(`${API_BASE}/move?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        method: "POST",
      });
      refresh();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });
  return btn;
}

function deleteButton(entry) {
  const btn = document.createElement("button");
  btn.className = "row-action danger";
  btn.type = "button";
  btn.textContent = "delete";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const childPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    if (!confirm(`Delete "${entry.name}"?`)) return;

    const params = new URLSearchParams({ path: childPath });
    if (entry.is_dir) params.set("recursive", "true");

    try {
      await api(`${API_BASE}?${params.toString()}`, { method: "DELETE" });
      refresh();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });
  return btn;
}

function downloadFile(path) {
  const params = new URLSearchParams({ path });
  const token = localStorage.getItem(TOKEN_KEY);
  const url = `${API_BASE}/download?${params.toString()}`;
  // A plain navigation can't set an Authorization header, so when a token
  // is set we fetch as a blob and hand the browser an object URL instead.
  if (!token) {
    window.location.href = url;
    return;
  }
  api(url)
    .then((res) => res.blob())
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = path.split("/").pop();
      a.click();
      URL.revokeObjectURL(objectUrl);
    })
    .catch((err) => setStatus(`error: ${err.message}`, true));
}

async function moveIntoDirectory(fromPath, destDirPath) {
  const baseName = fromPath.split("/").pop();
  const toPath = destDirPath ? `${destDirPath}/${baseName}` : baseName;

  if (fromPath === toPath) return; // dropped onto its own parent, no-op
  if (destDirPath === fromPath || destDirPath.startsWith(`${fromPath}/`)) {
    setStatus("error: can't move a folder into itself", true);
    return;
  }

  try {
    await api(`${API_BASE}/move?from=${encodeURIComponent(fromPath)}&to=${encodeURIComponent(toPath)}`, {
      method: "POST",
    });
    refresh();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

async function onNewFolder() {
  const name = prompt("Folder name:");
  if (!name) return;
  const path = currentPath ? `${currentPath}/${name}` : name;
  try {
    await api(`${API_BASE}/mkdir?path=${encodeURIComponent(path)}`, { method: "POST" });
    refresh();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

function openInNewTab(path) {
  const token = localStorage.getItem(TOKEN_KEY);
  const url = `${API_BASE}/view?path=${encodeURIComponent(path)}`;

  if (!token) {
    window.open(url, "_blank", "noopener");
    return;
  }

  // A plain window.open() can't attach an Authorization header, so when a
  // token is set we fetch the bytes ourselves and open an object URL instead.
  api(url)
    .then((res) => res.blob())
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener");
      // Deliberately not revoked immediately — the new tab still needs it.
    })
    .catch((err) => setStatus(`error: ${err.message}`, true));
}

async function resolveViewUrl(path) {
  const url = `${API_BASE}/view?path=${encodeURIComponent(path)}`;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return url;
  const res = await api(url);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/// --- bulk / folder upload ------------------------------------------------

// Normalizes a plain <input type=file> FileList into {file, relPath} pairs.
// When the input has `webkitdirectory` set, each File carries its path
// within the chosen folder in `webkitRelativePath`.
function entriesFromFileList(fileList) {
  return Array.from(fileList).map((file) => ({
    file,
    relPath: file.webkitRelativePath || file.name,
  }));
}

// Walks whatever was dropped on the page — individual files, or whole
// folders — into a flat list of {file, relPath} pairs. Falls back to a
// plain file list on browsers without the drag-and-drop directory API.
async function collectFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items;
  const out = [];

  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
    const entries = Array.from(items)
      .map((item) => item.webkitGetAsEntry && item.webkitGetAsEntry())
      .filter(Boolean);

    if (entries.length > 0) {
      for (const entry of entries) {
        await walkEntry(entry, "", out);
      }
      return out;
    }
  }

  for (const file of dataTransfer.files) {
    out.push({ file, relPath: file.name });
  }
  return out;
}

async function walkEntry(entry, basePath, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, relPath: basePath ? `${basePath}/${entry.name}` : entry.name });
  } else if (entry.isDirectory) {
    const nextBase = basePath ? `${basePath}/${entry.name}` : entry.name;
    const children = await readAllEntries(entry.createReader());
    for (const child of children) {
      await walkEntry(child, nextBase, out);
    }
  }
}

function readAllEntries(reader) {
  // A single readEntries() call caps out at ~100 results in some browsers,
  // so keep calling it until it comes back empty.
  return new Promise((resolve, reject) => {
    let all = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
        } else {
          all = all.concat(batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

async function uploadEntries(entries) {
  if (!entries || entries.length === 0) return;

  // Group files by the destination directory they land in, so each folder
  // of files becomes a single multipart upload instead of one request per
  // file (the upload endpoint already `create_dir_all`s the destination).
  const groups = new Map(); // destDir -> File[]
  for (const { file, relPath } of entries) {
    const parts = relPath.split("/");
    parts.pop(); // drop the filename, keep just the subdirectory portion
    const subDir = parts.join("/");
    const destDir = subDir ? (currentPath ? `${currentPath}/${subDir}` : subDir) : currentPath;
    if (!groups.has(destDir)) groups.set(destDir, []);
    groups.get(destDir).push(file);
  }

  const destDirs = Array.from(groups.keys());
  let done = 0;
  setStatus(`uploading 0/${destDirs.length} folder${destDirs.length === 1 ? "" : "s"}…`);

  for (const destDir of destDirs) {
    const form = new FormData();
    for (const file of groups.get(destDir)) form.append("file", file, file.name);

    try {
      await api(`${API_BASE}/upload?path=${encodeURIComponent(destDir)}`, {
        method: "POST",
        body: form,
      });
    } catch (err) {
      setStatus(`error uploading to ${destDir || "~"}: ${err.message}`, true);
      return;
    }

    done += 1;
    setStatus(`uploading ${done}/${destDirs.length} folder${destDirs.length === 1 ? "" : "s"}…`);
  }

  refresh();
}

// --- formatting ---------------------------------------------------------

function extOf(name) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function parentOf(path) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatDate(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}
