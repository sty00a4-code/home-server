// Tiny vanilla-JS frontend for the /api/finance app. Same no-build-step
// approach and shared auth token as the other apps.

const API_BASE = "/api/finance";
const TOKEN_KEY = "home-server-token"; // shared with the other apps

let paymentTypes = [];
let categories = [];
let transactions = [];
let scheduled = [];
let editingTransactionId = null;
let editingScheduledId = null;

const summaryCardsEl = document.getElementById("summary-cards");
const filterCategoryEl = document.getElementById("filter-category");
const transactionsBodyEl = document.getElementById("transactions-body");
const transactionsEmptyEl = document.getElementById("transactions-empty");
const scheduledBodyEl = document.getElementById("scheduled-body");
const categoriesBodyEl = document.getElementById("categories-body");
const paymentTypesBodyEl = document.getElementById("payment-types-body");
const statusEl = document.getElementById("status-text");

const transactionFormEl = document.getElementById("transaction-form");
const scheduledFormEl = document.getElementById("scheduled-form");
const categoryFormEl = document.getElementById("category-form");
const paymentTypeFormEl = document.getElementById("payment-type-form");

init();

async function init() {
  transactionFormEl.addEventListener("submit", onAddTransaction);
  scheduledFormEl.addEventListener("submit", onAddScheduled);
  categoryFormEl.addEventListener("submit", onAddCategory);
  paymentTypeFormEl.addEventListener("submit", onAddPaymentType);
  filterCategoryEl.addEventListener("change", renderTransactions);

  await refreshAll();
}

// --- API helper (same shape as the other apps') ---------------------------

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

// --- date helpers ----------------------------------------------------
//
// Everything typed or shown to a person is dd/mm/yyyy (optionally with a
// time), converted to/from the API's ISO format under the hood.

function dmyToIsoDate(dmy) {
  const trimmed = dmy.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`"${trimmed}" isn't a dd/mm/yyyy date`);
  const [, d, mo, y] = m;
  assertValidDate(y, mo, d, trimmed);
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function dmyHmToIsoDateTime(dmyHm) {
  const trimmed = dmyHm.trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`"${trimmed}" isn't a dd/mm/yyyy hh:mm date & time`);
  const [, d, mo, y, h, min] = m;
  assertValidDate(y, mo, d, trimmed);
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")} ${h.padStart(2, "0")}:${min}`;
}

function assertValidDate(y, mo, d, original) {
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  const valid = date.getUTCFullYear() === +y && date.getUTCMonth() === +mo - 1 && date.getUTCDate() === +d;
  if (!valid) throw new Error(`"${original}" isn't a valid date`);
}

function isoDateToDmy(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function isoDateTimeToDmyHm(iso) {
  if (!iso) return "";
  const [datePart, timePart] = iso.split(" ");
  return `${isoDateToDmy(datePart)} ${timePart ?? "00:00"}`;
}

// --- data loading -----------------------------------------------------

async function refreshAll() {
  setStatus("loading…");
  try {
    const [pts, cats, txs, sched] = await Promise.all([
      api(`${API_BASE}/payment-types`),
      api(`${API_BASE}/categories`),
      api(`${API_BASE}/transactions`),
      api(`${API_BASE}/scheduled`),
    ]);
    paymentTypes = pts;
    categories = cats;
    transactions = txs;
    scheduled = sched;

    populateSelects();
    renderCategories();
    renderPaymentTypes();
    renderScheduled();
    renderTransactions();
    await renderSummary();

    setStatus(`${transactions.length} transaction${transactions.length === 1 ? "" : "s"}`);
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

async function renderSummary() {
  summaryCardsEl.innerHTML = "";
  let s;
  try {
    s = await api(`${API_BASE}/summary`);
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
    return;
  }

  const hero = document.createElement("div");
  hero.className = "card hero-card";
  hero.innerHTML = `
    <div class="hero-figure">
      <span class="label">capital</span>
      <span class="value ${s.capital >= 0 ? "" : "amount negative"}">${formatMoney(s.capital)}</span>
    </div>
    <div class="hero-figure">
      <span class="label">daily allowance (${s.days_left_in_month} days left in ${s.month_label})</span>
      <span class="value primary">${formatMoney(s.daily_allowance)} / day</span>
    </div>
    <div class="hero-figure small">
      <span class="label">income this month</span>
      <span class="value amount positive">${formatMoney(s.income_this_month)}</span>
    </div>
    <div class="hero-figure small">
      <span class="label">spent this month</span>
      <span class="value amount negative">${formatMoney(s.spent_this_month)}</span>
    </div>
  `;
  summaryCardsEl.appendChild(hero);
}

// --- selects / setup tables ---------------------------------------------

function categoryDisplayName(cat) {
  return cat.parent_id ? `↳ ${cat.name}` : cat.name;
}

function categoryOptionsHtml(selectedId) {
  // top-level categories first, each immediately followed by its children
  const topLevel = categories.filter((c) => !c.parent_id);
  const childrenOf = (id) => categories.filter((c) => c.parent_id === id);
  let html = "";
  for (const top of topLevel) {
    html += `<option value="${top.id}" ${top.id === selectedId ? "selected" : ""}>${escapeHtml(top.name)}</option>`;
    for (const child of childrenOf(top.id)) {
      html += `<option value="${child.id}" ${child.id === selectedId ? "selected" : ""}>&nbsp;&nbsp;↳ ${escapeHtml(child.name)}</option>`;
    }
  }
  return html;
}

function paymentTypeOptionsHtml(selectedId) {
  return paymentTypes
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
}

function populateSelects() {
  filterCategoryEl.innerHTML = `<option value="">all categories</option>${categoryOptionsHtml(null)}`;
  document.getElementById("t-category").innerHTML = `<option value="">—</option>${categoryOptionsHtml(null)}`;
  document.getElementById("t-payment-type").innerHTML = `<option value="">—</option>${paymentTypeOptionsHtml(null)}`;
  document.getElementById("sc-category").innerHTML = `<option value="">category —</option>${categoryOptionsHtml(null)}`;
  document.getElementById("sc-payment-type").innerHTML = `<option value="">payment type —</option>${paymentTypeOptionsHtml(null)}`;
  document.getElementById("c-parent").innerHTML =
    `<option value="">no parent (top-level)</option>` +
    categories.filter((c) => !c.parent_id).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
}

function renderCategories() {
  categoriesBodyEl.innerHTML = "";
  const topLevel = categories.filter((c) => !c.parent_id);
  const childrenOf = (id) => categories.filter((c) => c.parent_id === id);

  const addRow = (cat, isChild) => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.className = isChild ? "category-child" : "";
    nameTd.textContent = cat.name;
    tr.appendChild(nameTd);

    const actionsTd = document.createElement("td");
    actionsTd.className = "col-actions";
    const delBtn = document.createElement("button");
    delBtn.className = "row-action danger";
    delBtn.type = "button";
    delBtn.textContent = "delete";
    delBtn.addEventListener("click", async () => {
      try {
        await api(`${API_BASE}/categories/${cat.id}`, { method: "DELETE" });
        await refreshAll();
      } catch (err) {
        setStatus(`error: ${err.message}`, true);
      }
    });
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);
    categoriesBodyEl.appendChild(tr);
  };

  for (const top of topLevel) {
    addRow(top, false);
    for (const child of childrenOf(top.id)) addRow(child, true);
  }
}

function renderPaymentTypes() {
  paymentTypesBodyEl.innerHTML = "";
  for (const pt of paymentTypes) {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.textContent = pt.name;
    tr.appendChild(nameTd);

    const actionsTd = document.createElement("td");
    actionsTd.className = "col-actions";
    const delBtn = document.createElement("button");
    delBtn.className = "row-action danger";
    delBtn.type = "button";
    delBtn.textContent = "delete";
    delBtn.addEventListener("click", async () => {
      try {
        await api(`${API_BASE}/payment-types/${pt.id}`, { method: "DELETE" });
        await refreshAll();
      } catch (err) {
        setStatus(`error: ${err.message}`, true);
      }
    });
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);
    paymentTypesBodyEl.appendChild(tr);
  }
}

// --- transactions table -------------------------------------------------

function categoryName(id) {
  const c = categories.find((c) => c.id === id);
  return c ? categoryDisplayName(c) : "—";
}

function paymentTypeName(id) {
  const p = paymentTypes.find((p) => p.id === id);
  return p ? p.name : "—";
}

function formatMoney(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(2)} €`;
}

function renderTransactions() {
  const categoryFilter = filterCategoryEl.value;
  const visible = transactions.filter(
    (t) => !categoryFilter || String(t.category_id) === categoryFilter
  );

  transactionsBodyEl.innerHTML = "";
  transactionsEmptyEl.hidden = visible.length > 0;

  for (const t of visible) {
    transactionsBodyEl.appendChild(
      editingTransactionId === t.id ? transactionEditRow(t) : transactionRow(t)
    );
  }
}

function transactionRow(t) {
  const tr = document.createElement("tr");

  const dateTd = document.createElement("td");
  dateTd.className = "col-size";
  dateTd.textContent = isoDateTimeToDmyHm(t.occurred_at);
  tr.appendChild(dateTd);

  const descTd = document.createElement("td");
  descTd.textContent = t.description;
  if (t.scheduled_transaction_id) {
    const badge = document.createElement("span");
    badge.className = "badge auto";
    badge.textContent = " auto";
    descTd.appendChild(badge);
  }
  tr.appendChild(descTd);

  const sentToTd = document.createElement("td");
  sentToTd.textContent = t.sent_to || "—";
  tr.appendChild(sentToTd);

  const catTd = document.createElement("td");
  catTd.textContent = categoryName(t.category_id);
  tr.appendChild(catTd);

  const typeTd = document.createElement("td");
  typeTd.textContent = paymentTypeName(t.payment_type_id);
  tr.appendChild(typeTd);

  const amountTd = document.createElement("td");
  amountTd.className = `amount ${t.amount >= 0 ? "positive" : "negative"}`;
  amountTd.textContent = formatMoney(t.amount);
  tr.appendChild(amountTd);

  const actionsTd = document.createElement("td");
  actionsTd.className = "col-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "row-action";
  editBtn.type = "button";
  editBtn.textContent = "edit";
  editBtn.addEventListener("click", () => {
    editingTransactionId = t.id;
    renderTransactions();
  });
  actionsTd.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "row-action danger";
  delBtn.type = "button";
  delBtn.textContent = "delete";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete "${t.description}"?`)) return;
    try {
      await api(`${API_BASE}/transactions/${t.id}`, { method: "DELETE" });
      await refreshAll();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });
  actionsTd.appendChild(delBtn);
  tr.appendChild(actionsTd);

  return tr;
}

function transactionEditRow(t) {
  const tr = document.createElement("tr");
  tr.className = "edit-subrow";
  const td = document.createElement("td");
  td.colSpan = 7;

  td.innerHTML = `
    <form class="edit-form">
      <div class="field">
        <label>Date &amp; time</label>
        <input class="et-date" type="text" value="${escapeAttr(isoDateTimeToDmyHm(t.occurred_at))}" required />
      </div>
      <div class="field">
        <label>Amount</label>
        <input class="et-amount" type="number" step="0.01" value="${t.amount}" required />
      </div>
      <div class="field wide">
        <label>Description</label>
        <input class="et-description" type="text" value="${escapeAttr(t.description)}" required />
      </div>
      <div class="field">
        <label>Sent to</label>
        <input class="et-sent-to" type="text" value="${escapeAttr(t.sent_to || "")}" />
      </div>
      <div class="field">
        <label>Payment type</label>
        <select class="et-payment-type"><option value="">—</option>${paymentTypeOptionsHtml(t.payment_type_id)}</select>
      </div>
      <div class="field">
        <label>Category</label>
        <select class="et-category"><option value="">—</option>${categoryOptionsHtml(t.category_id)}</select>
      </div>
      <div class="field wide edit-actions">
        <button class="btn btn-primary" type="submit">Save</button>
        <button class="btn" type="button" id="tx-cancel-${t.id}">Cancel</button>
      </div>
    </form>
  `;
  tr.appendChild(td);

  td.querySelector(`#tx-cancel-${t.id}`).addEventListener("click", () => {
    editingTransactionId = null;
    renderTransactions();
  });

  td.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    let isoDateTime;
    try {
      isoDateTime = dmyHmToIsoDateTime(td.querySelector(".et-date").value);
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
      return;
    }
    const paymentTypeId = td.querySelector(".et-payment-type").value;
    const categoryId = td.querySelector(".et-category").value;

    const payload = {
      amount: parseFloat(td.querySelector(".et-amount").value),
      occurred_at: isoDateTime,
      description: td.querySelector(".et-description").value,
      sent_to: td.querySelector(".et-sent-to").value || null,
      payment_type_id: paymentTypeId ? parseInt(paymentTypeId, 10) : null,
      category_id: categoryId ? parseInt(categoryId, 10) : null,
      notes: t.notes,
    };

    try {
      await api(`${API_BASE}/transactions/${t.id}`, { method: "PUT", body: JSON.stringify(payload) });
      editingTransactionId = null;
      await refreshAll();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });

  return tr;
}

async function onAddTransaction(e) {
  e.preventDefault();
  let isoDateTime;
  try {
    isoDateTime = dmyHmToIsoDateTime(document.getElementById("t-date").value);
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
    return;
  }

  const paymentTypeId = document.getElementById("t-payment-type").value;
  const categoryId = document.getElementById("t-category").value;

  const payload = {
    amount: parseFloat(document.getElementById("t-amount").value),
    occurred_at: isoDateTime,
    description: document.getElementById("t-description").value,
    sent_to: document.getElementById("t-sent-to").value || null,
    payment_type_id: paymentTypeId ? parseInt(paymentTypeId, 10) : null,
    category_id: categoryId ? parseInt(categoryId, 10) : null,
    notes: null,
  };

  try {
    await api(`${API_BASE}/transactions`, { method: "POST", body: JSON.stringify(payload) });
    transactionFormEl.reset();
    await refreshAll();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

// --- scheduled transactions ----------------------------------------------

function renderScheduled() {
  scheduledBodyEl.innerHTML = "";
  for (const s of scheduled) {
    scheduledBodyEl.appendChild(editingScheduledId === s.id ? scheduledEditRow(s) : scheduledRow(s));
  }
}

function scheduledRow(s) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${escapeHtml(s.description)}</td>
    <td class="amount ${s.amount >= 0 ? "positive" : "negative"}">${formatMoney(s.amount)}</td>
    <td class="col-size">${s.day_of_month}</td>
    <td class="col-size">${escapeHtml(isoDateToDmy(s.start_date))}</td>
    <td class="col-size">${s.end_date ? escapeHtml(isoDateToDmy(s.end_date)) : "—"}</td>
    <td>${s.active ? "✓" : "—"}</td>
    <td class="col-actions"></td>
  `;
  const actionsTd = tr.querySelector(".col-actions");

  const editBtn = document.createElement("button");
  editBtn.className = "row-action";
  editBtn.type = "button";
  editBtn.textContent = "edit";
  editBtn.addEventListener("click", () => {
    editingScheduledId = s.id;
    renderScheduled();
  });
  actionsTd.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "row-action danger";
  delBtn.type = "button";
  delBtn.textContent = "delete";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete schedule "${s.description}"? Already-recorded transactions stay.`)) return;
    try {
      await api(`${API_BASE}/scheduled/${s.id}`, { method: "DELETE" });
      await refreshAll();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });
  actionsTd.appendChild(delBtn);

  return tr;
}

function scheduledEditRow(s) {
  const tr = document.createElement("tr");
  tr.className = "edit-subrow";
  const td = document.createElement("td");
  td.colSpan = 7;

  td.innerHTML = `
    <form class="edit-form">
      <div class="field wide">
        <label>Description</label>
        <input class="es-description" type="text" value="${escapeAttr(s.description)}" required />
      </div>
      <div class="field">
        <label>Amount</label>
        <input class="es-amount" type="number" step="0.01" value="${s.amount}" required />
      </div>
      <div class="field">
        <label>Day of month</label>
        <input class="es-day" type="number" min="1" max="31" value="${s.day_of_month}" required />
      </div>
      <div class="field">
        <label>Starts</label>
        <input class="es-start" type="text" value="${escapeAttr(isoDateToDmy(s.start_date))}" required />
      </div>
      <div class="field">
        <label>Ends (optional)</label>
        <input class="es-end" type="text" value="${escapeAttr(isoDateToDmy(s.end_date))}" />
      </div>
      <div class="field">
        <label>Payment type</label>
        <select class="es-payment-type"><option value="">—</option>${paymentTypeOptionsHtml(s.payment_type_id)}</select>
      </div>
      <div class="field">
        <label>Category</label>
        <select class="es-category"><option value="">—</option>${categoryOptionsHtml(s.category_id)}</select>
      </div>
      <div class="field">
        <label class="checkbox"><input class="es-active" type="checkbox" ${s.active ? "checked" : ""} /> active</label>
      </div>
      <div class="field wide edit-actions">
        <button class="btn btn-primary" type="submit">Save</button>
        <button class="btn" type="button" id="sched-cancel-${s.id}">Cancel</button>
      </div>
    </form>
  `;
  tr.appendChild(td);

  td.querySelector(`#sched-cancel-${s.id}`).addEventListener("click", () => {
    editingScheduledId = null;
    renderScheduled();
  });

  td.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    let startIso, endIso;
    try {
      startIso = dmyToIsoDate(td.querySelector(".es-start").value);
      endIso = dmyToIsoDate(td.querySelector(".es-end").value);
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
      return;
    }
    const paymentTypeId = td.querySelector(".es-payment-type").value;
    const categoryId = td.querySelector(".es-category").value;

    const payload = {
      amount: parseFloat(td.querySelector(".es-amount").value),
      description: td.querySelector(".es-description").value,
      sent_to: s.sent_to,
      payment_type_id: paymentTypeId ? parseInt(paymentTypeId, 10) : null,
      category_id: categoryId ? parseInt(categoryId, 10) : null,
      day_of_month: parseInt(td.querySelector(".es-day").value, 10),
      start_date: startIso,
      end_date: endIso,
      active: td.querySelector(".es-active").checked,
      notes: s.notes,
    };

    try {
      await api(`${API_BASE}/scheduled/${s.id}`, { method: "PUT", body: JSON.stringify(payload) });
      editingScheduledId = null;
      await refreshAll();
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
    }
  });

  return tr;
}

async function onAddScheduled(e) {
  e.preventDefault();
  let startIso, endIso;
  try {
    startIso = dmyToIsoDate(document.getElementById("sc-start").value);
    endIso = dmyToIsoDate(document.getElementById("sc-end").value);
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
    return;
  }

  const paymentTypeId = document.getElementById("sc-payment-type").value;
  const categoryId = document.getElementById("sc-category").value;

  const payload = {
    amount: parseFloat(document.getElementById("sc-amount").value),
    description: document.getElementById("sc-description").value,
    sent_to: null,
    payment_type_id: paymentTypeId ? parseInt(paymentTypeId, 10) : null,
    category_id: categoryId ? parseInt(categoryId, 10) : null,
    day_of_month: parseInt(document.getElementById("sc-day").value, 10),
    start_date: startIso,
    end_date: endIso,
    active: true,
    notes: null,
  };

  try {
    await api(`${API_BASE}/scheduled`, { method: "POST", body: JSON.stringify(payload) });
    scheduledFormEl.reset();
    await refreshAll();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

// --- category / payment-type add forms ------------------------------------

async function onAddCategory(e) {
  e.preventDefault();
  const parentId = document.getElementById("c-parent").value;
  const payload = {
    name: document.getElementById("c-name").value,
    parent_id: parentId ? parseInt(parentId, 10) : null,
  };
  try {
    await api(`${API_BASE}/categories`, { method: "POST", body: JSON.stringify(payload) });
    categoryFormEl.reset();
    await refreshAll();
  } catch (err) {
    setStatus(`error: ${err.message}`, true);
  }
}

async function onAddPaymentType(e) {
  e.preventDefault();
  const payload = { name: document.getElementById("pt-name").value };
  try {
    await api(`${API_BASE}/payment-types`, { method: "POST", body: JSON.stringify(payload) });
    paymentTypeFormEl.reset();
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

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', "&quot;");
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}
