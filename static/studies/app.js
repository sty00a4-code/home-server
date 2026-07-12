// Tiny vanilla-JS frontend for the /api/studies app. Same no-build-step
// approach as the files app, and shares its auth token from localStorage.

const API_BASE = "/api/studies";
const TOKEN_KEY = "home-server-token"; // shared with the files app

const STATUS_LABELS = {
  geplant: "geplant",
  angemeldet: "angemeldet",
  laufend: "laufend",
  bestanden: "bestanden",
  nicht_bestanden: "nicht bestanden",
  abgebrochen: "abgebrochen",
};

const EXAM_TYPES = [
  "Klausur",
  "Hausarbeit",
  "Muendliche_Pruefung",
  "Portfolio",
  "Projektbericht",
  "Referat",
  "Praktikum",
  "Abschlussarbeit",
  "Sonstige",
];

const MODULE_KINDS = ["Pflicht", "Wahlpflicht", "Wahl"];

let semesters = [];
let programs = [];
let modules = [];
let openExamRows = new Set(); // module ids whose exam sub-row is expanded
let editingModuleId = null; // module id whose edit form is open, or null
let editingExamId = null; // exam id whose row is in edit mode, or null

const summaryCardsEl = document.getElementById("summary-cards");
const filterProgramEl = document.getElementById("filter-program");
const filterStatusEl = document.getElementById("filter-status");
const modulesBodyEl = document.getElementById("modules-body");
const modulesEmptyEl = document.getElementById("modules-empty");
const programsBodyEl = document.getElementById("programs-body");
const semestersBodyEl = document.getElementById("semesters-body");
const statusEl = document.getElementById("status-text");

const moduleFormEl = document.getElementById("module-form");
const programFormEl = document.getElementById("program-form");
const semesterFormEl = document.getElementById("semester-form");

init();

async function init() {
  moduleFormEl.addEventListener("submit", onAddModule);
  programFormEl.addEventListener("submit", onAddProgram);
  semesterFormEl.addEventListener("submit", onAddSemester);
  filterProgramEl.addEventListener("change", renderModules);
  filterStatusEl.addEventListener("change", renderModules);

  await refreshAll();
}

// --- API helper (same shape as the files app's) ---------------------------

async function api(path, opts = {}) {
  const headers = opts.headers ? { ...opts.headers } : {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const res = await fetch(path, { ...opts, headers });

  if (res.status === 401) {
    const entered = prompt("This server requires an access token:");
    if (entered) {
      localStorage.setItem(TOKEN_KEY, entered);
      return api(path, opts);
    }
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      /* not JSON, statusText is fine */
    }
    throw new Error(message);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- date helpers ---------------------------------------------------------
//
// The API stores exam dates as ISO (yyyy-mm-dd) so they sort correctly, but
// every date the person actually types or reads is dd/mm/yyyy — a plain
// text input rather than <input type="date"> so we're not at the mercy of
// the browser's locale (which is what showed mm/dd/yyyy before).

function isoToDmy(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// Returns an ISO date string, or null for an empty input. Throws if the
// text doesn't look like a valid dd/mm/yyyy date.
function dmyToIso(dmy) {
  const trimmed = dmy.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    throw new Error(`"${trimmed}" isn't a dd/mm/yyyy date`);
  }
  const [, dStr, mStr, yStr] = match;
  const d = parseInt(dStr, 10);
  const m = parseInt(mStr, 10);
  const y = parseInt(yStr, 10);

  const date = new Date(Date.UTC(y, m - 1, d));
  const valid =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  if (!valid) {
    throw new Error(`"${trimmed}" isn't a valid date`);
  }

  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// --- data loading -----------------------------------------------------

async function refreshAll() {
  setStatus("loading…");
  try {
    const [sem, prog, mods] = await Promise.all([
      api(`${API_BASE}/semesters`),
      api(`${API_BASE}/programs`),
      api(`${API_BASE}/modules`),
    ]);
    semesters = sem;
    programs = prog;
    modules = mods;

    populateProgramSelects();
    populateSemesterSelects();
    renderPrograms();
    renderSemesters();
    renderModules();
    await renderSummary();

    setStatus(`${modules.length} module${modules.length === 1 ? "" : "s"} tracked`);
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

async function renderSummary() {
  summaryCardsEl.innerHTML = "";
  let rows;
  try {
    rows = await api(`${API_BASE}/summary`);
  } catch {
    return;
  }

  if (rows.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "add a study program below to start tracking progress";
    summaryCardsEl.appendChild(p);
    return;
  }

  for (const row of rows) {
    const card = document.createElement("div");
    card.className = "card stat-card";

    const pct = row.lp_required > 0 ? Math.min(100, (row.lp_earned / row.lp_required) * 100) : 0;

    card.innerHTML = `
      <div class="card-body">
        <h2>${escapeHtml(row.study_program_name)}</h2>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="card-stat">${row.lp_earned} / ${row.lp_required} LP</span>
        ${
          row.lp_weighted_average_grade != null
            ? `<span class="card-note">Ø ${row.lp_weighted_average_grade.toFixed(2)}</span>`
            : ""
        }
      </div>
    `;
    summaryCardsEl.appendChild(card);
  }
}

// --- selects / setup tables -------------------------------------------

function populateProgramSelects() {
  const optionsHtml = programs
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");

  filterProgramEl.innerHTML = `<option value="">all programs</option>${optionsHtml}`;
  document.getElementById("m-program").innerHTML = optionsHtml;
}

function populateSemesterSelects() {
  const optionsHtml = semesters.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join("");
  document.getElementById("m-semester").innerHTML =
    `<option value="">— none —</option>${optionsHtml}`;
}

function renderPrograms() {
  programsBodyEl.innerHTML = "";
  for (const p of programs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.degree)}</td>
      <td>${escapeHtml(p.po_version || "—")}</td>
      <td class="col-size">${p.lp_required}</td>
      <td>${p.is_primary ? "★" : ""}</td>
    `;
    programsBodyEl.appendChild(tr);
  }
}

function renderSemesters() {
  semestersBodyEl.innerHTML = "";
  for (const s of semesters) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.label)}</td>
      <td>${escapeHtml(s.term)}</td>
      <td class="col-size">${s.start_year}</td>
    `;
    semestersBodyEl.appendChild(tr);
  }
}

// --- modules table -------------------------------------------------------

function renderModules() {
  const programFilter = filterProgramEl.value;
  const statusFilter = filterStatusEl.value;

  const visible = modules.filter((m) => {
    if (programFilter && String(m.study_program_id) !== programFilter) return false;
    if (statusFilter && m.status !== statusFilter) return false;
    return true;
  });

  modulesBodyEl.innerHTML = "";
  modulesEmptyEl.hidden = visible.length > 0;

  for (const m of visible) {
    modulesBodyEl.appendChild(moduleRow(m));
    if (editingModuleId === m.id) {
      modulesBodyEl.appendChild(moduleEditRow(m));
    } else if (openExamRows.has(m.id)) {
      modulesBodyEl.appendChild(examSubRow(m));
      loadExamsInto(m.id);
    }
  }
}

function semesterLabel(id) {
  const s = semesters.find((s) => s.id === id);
  return s ? s.label : "—";
}

function moduleRow(m) {
  const tr = document.createElement("tr");
  tr.className = `status-${m.status}`;

  const nameTd = document.createElement("td");
  const nameBtn = document.createElement("button");
  nameBtn.className = "row-action exams-toggle";
  nameBtn.type = "button";
  nameBtn.textContent = (openExamRows.has(m.id) ? "▾ " : "▸ ") + m.title;
  nameBtn.addEventListener("click", () => {
    if (editingModuleId === m.id) editingModuleId = null;
    if (openExamRows.has(m.id)) openExamRows.delete(m.id);
    else openExamRows.add(m.id);
    renderModules();
  });
  nameTd.appendChild(nameBtn);
  tr.appendChild(nameTd);

  const codeTd = document.createElement("td");
  codeTd.className = "col-size";
  codeTd.textContent = m.module_code || "—";
  tr.appendChild(codeTd);

  const lpTd = document.createElement("td");
  lpTd.className = "col-size";
  lpTd.textContent = m.lp;
  tr.appendChild(lpTd);

  const kindTd = document.createElement("td");
  kindTd.textContent = m.module_kind;
  tr.appendChild(kindTd);

  const statusTd = document.createElement("td");
  const statusSelect = document.createElement("select");
  statusSelect.className = "inline-select";
  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === m.status) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  statusSelect.addEventListener("change", () => updateModule(m, { status: statusSelect.value }));
  statusTd.appendChild(statusSelect);
  tr.appendChild(statusTd);

  const semTd = document.createElement("td");
  semTd.className = "col-size";
  semTd.textContent = m.completed_semester_id
    ? semesterLabel(m.completed_semester_id)
    : m.planned_semester_id
      ? semesterLabel(m.planned_semester_id)
      : "—";
  tr.appendChild(semTd);

  const gradeTd = document.createElement("td");
  const gradeInput = document.createElement("input");
  gradeInput.type = "number";
  gradeInput.step = "0.1";
  gradeInput.min = "1";
  gradeInput.max = "5";
  gradeInput.className = "inline-input";
  gradeInput.value = m.final_grade ?? "";
  gradeInput.placeholder = "—";
  gradeInput.addEventListener("change", () =>
    updateModule(m, { final_grade: gradeInput.value === "" ? null : parseFloat(gradeInput.value) })
  );
  gradeTd.appendChild(gradeInput);
  tr.appendChild(gradeTd);

  const actionsTd = document.createElement("td");
  actionsTd.className = "col-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "row-action";
  editBtn.type = "button";
  editBtn.textContent = editingModuleId === m.id ? "close" : "edit";
  editBtn.addEventListener("click", () => {
    openExamRows.delete(m.id);
    editingModuleId = editingModuleId === m.id ? null : m.id;
    renderModules();
  });
  actionsTd.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "row-action danger";
  delBtn.type = "button";
  delBtn.textContent = "delete";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete "${m.title}"? This also deletes its exam records.`)) return;
    try {
      await api(`${API_BASE}/modules/${m.id}`, { method: "DELETE" });
      await refreshAll();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });
  actionsTd.appendChild(delBtn);
  tr.appendChild(actionsTd);

  return tr;
}

// Full edit form for a module — every field, not just the inline
// status/grade quick-edit in the row above.
function moduleEditRow(m) {
  const tr = document.createElement("tr");
  tr.className = "edit-subrow";
  const td = document.createElement("td");
  td.colSpan = 8;

  const programOptions = programs
    .map((p) => `<option value="${p.id}" ${p.id === m.study_program_id ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
  const kindOptions = MODULE_KINDS.map(
    (k) => `<option value="${k}" ${k === m.module_kind ? "selected" : ""}>${k}</option>`
  ).join("");
  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([v, label]) => `<option value="${v}" ${v === m.status ? "selected" : ""}>${label}</option>`)
    .join("");
  const semesterOptions = (selectedId) =>
    `<option value="">— none —</option>` +
    semesters
      .map((s) => `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${escapeHtml(s.label)}</option>`)
      .join("");

  td.innerHTML = `
    <form class="edit-form" id="module-edit-form-${m.id}">
      <div class="field">
        <label>Study program</label>
        <select class="em-program">${programOptions}</select>
      </div>
      <div class="field">
        <label>Title</label>
        <input class="em-title" type="text" value="${escapeAttr(m.title)}" required />
      </div>
      <div class="field">
        <label>Module code</label>
        <input class="em-code" type="text" value="${escapeAttr(m.module_code || "")}" />
      </div>
      <div class="field">
        <label>LP</label>
        <input class="em-lp" type="number" step="0.5" min="0" value="${m.lp}" required />
      </div>
      <div class="field">
        <label>Kind</label>
        <select class="em-kind">${kindOptions}</select>
      </div>
      <div class="field">
        <label>Status</label>
        <select class="em-status">${statusOptions}</select>
      </div>
      <div class="field">
        <label>Planned semester</label>
        <select class="em-planned-semester">${semesterOptions(m.planned_semester_id)}</select>
      </div>
      <div class="field">
        <label>Completed semester</label>
        <select class="em-completed-semester">${semesterOptions(m.completed_semester_id)}</select>
      </div>
      <div class="field">
        <label>Final grade</label>
        <input class="em-grade" type="number" step="0.1" min="1" max="5" value="${m.final_grade ?? ""}" />
      </div>
      <div class="field">
        <label>Module coordinator</label>
        <input class="em-coordinator" type="text" value="${escapeAttr(m.module_coordinator || "")}" />
      </div>
      <div class="field wide">
        <label>Notes</label>
        <input class="em-notes" type="text" value="${escapeAttr(m.notes || "")}" />
      </div>
      <div class="field wide edit-actions">
        <button class="btn btn-primary" type="submit">Save</button>
        <button class="btn" type="button" id="module-cancel-${m.id}">Cancel</button>
      </div>
    </form>
  `;
  tr.appendChild(td);

  td.querySelector(`#module-cancel-${m.id}`).addEventListener("click", () => {
    editingModuleId = null;
    renderModules();
  });

  td.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const grade = td.querySelector(".em-grade").value;
    const plannedSem = td.querySelector(".em-planned-semester").value;
    const completedSem = td.querySelector(".em-completed-semester").value;

    const payload = {
      study_program_id: parseInt(td.querySelector(".em-program").value, 10),
      po_area_id: m.po_area_id,
      module_code: td.querySelector(".em-code").value || null,
      title: td.querySelector(".em-title").value,
      lp: parseFloat(td.querySelector(".em-lp").value),
      module_kind: td.querySelector(".em-kind").value,
      recommended_semester: m.recommended_semester,
      status: td.querySelector(".em-status").value,
      planned_semester_id: plannedSem ? parseInt(plannedSem, 10) : null,
      completed_semester_id: completedSem ? parseInt(completedSem, 10) : null,
      final_grade: grade === "" ? null : parseFloat(grade),
      module_coordinator: td.querySelector(".em-coordinator").value || null,
      notes: td.querySelector(".em-notes").value || null,
    };

    try {
      await api(`${API_BASE}/modules/${m.id}`, { method: "PUT", body: JSON.stringify(payload) });
      editingModuleId = null;
      await refreshAll();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });

  return tr;
}

async function updateModule(m, patch) {
  const payload = {
    study_program_id: m.study_program_id,
    po_area_id: m.po_area_id,
    module_code: m.module_code,
    title: m.title,
    lp: m.lp,
    module_kind: m.module_kind,
    recommended_semester: m.recommended_semester,
    status: m.status,
    planned_semester_id: m.planned_semester_id,
    completed_semester_id: m.completed_semester_id,
    final_grade: m.final_grade,
    module_coordinator: m.module_coordinator,
    notes: m.notes,
    ...patch,
  };
  try {
    await api(`${API_BASE}/modules/${m.id}`, { method: "PUT", body: JSON.stringify(payload) });
    await refreshAll();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

// --- exam sub-panel -----------------------------------------------------

function examTypeOptions(selected) {
  return EXAM_TYPES.map((t) => `<option value="${t}" ${t === selected ? "selected" : ""}>${t}</option>`).join("");
}

function passedOptions(selected) {
  // selected: true | false | null
  const opts = [
    { value: "", label: "ausstehend" },
    { value: "true", label: "bestanden" },
    { value: "false", label: "nicht bestanden" },
  ];
  const selectedValue = selected === true ? "true" : selected === false ? "false" : "";
  return opts
    .map((o) => `<option value="${o.value}" ${o.value === selectedValue ? "selected" : ""}>${o.label}</option>`)
    .join("");
}

function examSubRow(m) {
  const tr = document.createElement("tr");
  tr.className = "exam-subrow";
  const td = document.createElement("td");
  td.colSpan = 8;
  td.innerHTML = `
    <div class="exam-panel" id="exam-panel-${m.id}">
      <table class="listing nested">
        <thead>
          <tr><th>type</th><th>semester</th><th>attempt</th><th>date</th><th>grade</th><th>passed</th><th></th></tr>
        </thead>
        <tbody id="exams-body-${m.id}"><tr><td colspan="7">loading…</td></tr></tbody>
      </table>
      <form class="inline-form exam-form" data-module-id="${m.id}">
        <select class="e-type">${examTypeOptions("Klausur")}</select>
        <select class="e-semester">${semesters.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join("")}</select>
        <input class="e-attempt" type="number" min="1" max="3" value="1" title="attempt number" />
        <input class="e-date" type="text" placeholder="dd/mm/yyyy" pattern="\\d{1,2}/\\d{1,2}/\\d{4}" />
        <input class="e-grade" type="number" step="0.1" min="1" max="5" placeholder="grade" />
        <select class="e-passed">${passedOptions(null)}</select>
        <label class="checkbox"><input class="e-registered" type="checkbox" /> registered</label>
        <button class="btn" type="submit">+ Add exam</button>
      </form>
    </div>
  `;
  tr.appendChild(td);

  td.querySelector(".exam-form").addEventListener("submit", (e) => onAddExam(e, m.id));
  return tr;
}

async function loadExamsInto(moduleId) {
  const body = document.getElementById(`exams-body-${moduleId}`);
  if (!body) return;
  try {
    const exams = await api(`${API_BASE}/exams?module_id=${moduleId}`);
    body.innerHTML = "";
    if (exams.length === 0) {
      body.innerHTML = `<tr><td colspan="7" class="empty-state">no exams logged yet</td></tr>`;
      return;
    }
    for (const ex of exams) {
      body.appendChild(
        editingExamId === ex.id ? examEditRow(ex, moduleId) : examRow(ex, moduleId)
      );
    }
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7">error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function examRow(ex, moduleId) {
  const tr = document.createElement("tr");
  const passedLabel = ex.passed === true ? "✓" : ex.passed === false ? "✗" : "—";
  tr.innerHTML = `
    <td>${escapeHtml(ex.exam_type)}</td>
    <td>${escapeHtml(semesterLabel(ex.semester_id))}</td>
    <td class="col-size">${ex.attempt_number}</td>
    <td class="col-size">${escapeHtml(isoToDmy(ex.exam_date)) || "—"}</td>
    <td class="col-size">${ex.grade ?? "—"}</td>
    <td class="col-size">${passedLabel}</td>
    <td class="col-actions"></td>
  `;

  const actionsTd = tr.querySelector(".col-actions");

  const editBtn = document.createElement("button");
  editBtn.className = "row-action";
  editBtn.type = "button";
  editBtn.textContent = "edit";
  editBtn.addEventListener("click", () => {
    editingExamId = ex.id;
    loadExamsInto(moduleId);
  });
  actionsTd.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "row-action danger";
  delBtn.type = "button";
  delBtn.textContent = "delete";
  delBtn.addEventListener("click", async () => {
    try {
      await api(`${API_BASE}/exams/${ex.id}`, { method: "DELETE" });
      await loadExamsInto(moduleId);
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });
  actionsTd.appendChild(delBtn);

  return tr;
}

function examEditRow(ex, moduleId) {
  const tr = document.createElement("tr");
  tr.className = "exam-edit-row";
  const td = document.createElement("td");
  td.colSpan = 7;

  const semesterOptions = semesters
    .map((s) => `<option value="${s.id}" ${s.id === ex.semester_id ? "selected" : ""}>${escapeHtml(s.label)}</option>`)
    .join("");

  td.innerHTML = `
    <form class="inline-form exam-edit-form">
      <select class="ee-type">${examTypeOptions(ex.exam_type)}</select>
      <select class="ee-semester">${semesterOptions}</select>
      <input class="ee-attempt" type="number" min="1" max="3" value="${ex.attempt_number}" title="attempt number" />
      <input class="ee-date" type="text" placeholder="dd/mm/yyyy" pattern="\\d{1,2}/\\d{1,2}/\\d{4}" value="${escapeAttr(isoToDmy(ex.exam_date))}" />
      <input class="ee-grade" type="number" step="0.1" min="1" max="5" placeholder="grade" value="${ex.grade ?? ""}" />
      <select class="ee-passed">${passedOptions(ex.passed)}</select>
      <label class="checkbox"><input class="ee-registered" type="checkbox" ${ex.registered ? "checked" : ""} /> registered</label>
      <button class="btn btn-primary" type="submit">Save</button>
      <button class="btn" type="button" id="exam-cancel-${ex.id}">Cancel</button>
    </form>
  `;
  tr.appendChild(td);

  td.querySelector(`#exam-cancel-${ex.id}`).addEventListener("click", () => {
    editingExamId = null;
    loadExamsInto(moduleId);
  });

  td.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    let isoDate;
    try {
      isoDate = dmyToIso(td.querySelector(".ee-date").value);
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
      return;
    }
    const passedRaw = td.querySelector(".ee-passed").value;
    const gradeRaw = td.querySelector(".ee-grade").value;

    const payload = {
      module_id: moduleId,
      semester_id: parseInt(td.querySelector(".ee-semester").value, 10),
      exam_type: td.querySelector(".ee-type").value,
      attempt_number: parseInt(td.querySelector(".ee-attempt").value, 10) || 1,
      exam_date: isoDate,
      registered: td.querySelector(".ee-registered").checked,
      grade: gradeRaw === "" ? null : parseFloat(gradeRaw),
      passed: passedRaw === "" ? null : passedRaw === "true",
    };

    try {
      await api(`${API_BASE}/exams/${ex.id}`, { method: "PUT", body: JSON.stringify(payload) });
      editingExamId = null;
      await loadExamsInto(moduleId);
      await renderSummary();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });

  return tr;
}

async function onAddExam(e, moduleId) {
  e.preventDefault();
  const form = e.target;

  let isoDate;
  try {
    isoDate = dmyToIso(form.querySelector(".e-date").value);
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
    return;
  }

  const passedRaw = form.querySelector(".e-passed").value;
  const gradeRaw = form.querySelector(".e-grade").value;

  const payload = {
    module_id: moduleId,
    semester_id: parseInt(form.querySelector(".e-semester").value, 10),
    exam_type: form.querySelector(".e-type").value,
    attempt_number: parseInt(form.querySelector(".e-attempt").value, 10) || 1,
    exam_date: isoDate,
    registered: form.querySelector(".e-registered").checked,
    grade: gradeRaw === "" ? null : parseFloat(gradeRaw),
    passed: passedRaw === "" ? null : passedRaw === "true",
  };
  try {
    await api(`${API_BASE}/exams`, { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    await loadExamsInto(moduleId);
    await renderSummary();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

// --- add forms -----------------------------------------------------------

async function onAddModule(e) {
  e.preventDefault();
  const semesterId = document.getElementById("m-semester").value;
  const payload = {
    study_program_id: parseInt(document.getElementById("m-program").value, 10),
    title: document.getElementById("m-title").value,
    module_code: document.getElementById("m-code").value || null,
    lp: parseFloat(document.getElementById("m-lp").value),
    module_kind: document.getElementById("m-kind").value,
    status: document.getElementById("m-status").value,
    planned_semester_id: semesterId ? parseInt(semesterId, 10) : null,
  };
  if (!payload.study_program_id) {
    setStatus("error: add a study program first", true);
    return;
  }
  try {
    await api(`${API_BASE}/modules`, { method: "POST", body: JSON.stringify(payload) });
    moduleFormEl.reset();
    await refreshAll();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

async function onAddProgram(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById("p-name").value,
    degree: document.getElementById("p-degree").value,
    po_version: document.getElementById("p-po").value || null,
    lp_required: parseInt(document.getElementById("p-lp").value, 10),
    is_primary: document.getElementById("p-primary").checked,
  };
  try {
    await api(`${API_BASE}/programs`, { method: "POST", body: JSON.stringify(payload) });
    programFormEl.reset();
    await refreshAll();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

async function onAddSemester(e) {
  e.preventDefault();
  const payload = {
    label: document.getElementById("s-label").value,
    term: document.getElementById("s-term").value,
    start_year: parseInt(document.getElementById("s-year").value, 10),
    sort_order: parseInt(document.getElementById("s-order").value, 10),
  };
  try {
    await api(`${API_BASE}/semesters`, { method: "POST", body: JSON.stringify(payload) });
    semesterFormEl.reset();
    await refreshAll();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

// --- utils -----------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Like escapeHtml, but also safe to drop inside a double-quoted HTML
// attribute (escapes quotes too).
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', "&quot;");
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}
