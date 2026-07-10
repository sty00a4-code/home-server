// Tiny vanilla-JS file browser for the /api/files app. No build step, no
// framework — this is meant to stay easy to read alongside the Rust side.

const API_BASE = "/api/files";
const TOKEN_KEY = "home-server-token";

let currentPath = ""; // relative path, "" = root
let draggedEntryPath = null; // set while an internal row-drag is in progress

const breadcrumbEl = document.getElementById("breadcrumb");
const listingBodyEl = document.getElementById("listing-body");
const emptyStateEl = document.getElementById("empty-state");
const statusEl = document.getElementById("status-text");
const dropzoneEl = document.getElementById("dropzone");
const fileInputEl = document.getElementById("file-input");
const newFolderBtn = document.getElementById("new-folder-btn");

init();

function init() {
  newFolderBtn.addEventListener("click", onNewFolder);
  fileInputEl.addEventListener("change", () => uploadFiles(fileInputEl.files));

  ["dragenter", "dragover"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      if (!draggedEntryPath) dropzoneEl.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === "drop" && !draggedEntryPath) uploadFiles(e.dataTransfer.files);
      dropzoneEl.classList.remove("dragover");
    })
  );

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
    actionsTd.appendChild(deleteButton(entry));
    tr.appendChild(actionsTd);

    listingBodyEl.appendChild(tr);
  }
}

function entryNameButton(entry) {
  const btn = document.createElement("button");
  btn.className = "entry-name" + (entry.is_dir ? " is-dir" : "");
  btn.type = "button";

  const icon = document.createElement("span");
  icon.className = "entry-icon";
  icon.textContent = entry.is_dir ? "\u25B8" : "\u2013"; // ▸ or –
  btn.appendChild(icon);
  btn.appendChild(document.createTextNode(entry.name));

  btn.addEventListener("click", () => {
    const childPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    if (entry.is_dir) {
      currentPath = childPath;
      refresh();
    } else {
      downloadFile(childPath);
    }
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

async function uploadFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  setStatus(`uploading ${fileList.length} file${fileList.length === 1 ? "" : "s"}…`);

  const form = new FormData();
  for (const file of fileList) form.append("file", file, file.name);

  try {
    await api(`${API_BASE}/upload?path=${encodeURIComponent(currentPath)}`, {
      method: "POST",
      body: form,
    });
    fileInputEl.value = "";
    refresh();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

// --- formatting ---------------------------------------------------------

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
