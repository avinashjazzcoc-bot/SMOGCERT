const API_URL = "https://script.google.com/macros/s/AKfycbxu5MRXvTyZv1ZkI4hvUEuy-whUB98Ym675FahXTdKG4vx3C2rhRXLJzme1_EQWrhy76g/exec";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1S8a5kqVttJa7TSijjkEUzmL-F7rc039LHltu7rCi5j0/edit?gid=1544491919#gid=1544491919";
const SESSION_KEY = "smogcert_token";

let sessionToken = sessionStorage.getItem(SESSION_KEY) || "";
let vehicleData = [];
let actionHistory = [];
let currentView = "upcoming";
let currentFilter = "";
let currentPage = 1;
let rowsPerPage = 5;
let totalFilteredRows = 0;
let existingVehicleMatch = null;
const PAGE_SIZE = 5;

const $ = id => document.getElementById(id);
const tableBody = $("tableBody");

document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  if (sessionToken) {
    unlockUI();
    loadVehicles();
  } else {
    lockUI();
  }
});

function lockUI(message = "") {
  document.body.classList.add("locked");
  $("loginGate").style.display = "flex";
  $("loginError").textContent = message;
}

function unlockUI() {
  document.body.classList.remove("locked");
  $("loginGate").style.display = "none";
}

function logout() {
  sessionToken = "";
  sessionStorage.removeItem(SESSION_KEY);
  vehicleData = [];
  lockUI("");
}

async function apiPost(action, data = {}) {
  const params = new URLSearchParams();
  params.set("action", action);

  if (action !== "login") {
    params.set("token", sessionToken);
  }

  Object.entries(data).forEach(([k, v]) => {
    params.set(k, v == null ? "" : String(v));
  });

  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: params.toString(),
      cache: "no-store",
      redirect: "follow"
    });
  } catch (error) {
    throw new Error(
      "Unable to connect to the SMOGCERT server. Check the Google Apps Script deployment."
    );
  }

  const raw = await response.text();
  const trimmed = String(raw || "").trim();

  // Google returns an HTML page when the Web App deployment is not public,
  // is using an old/invalid deployment URL, or requires Google sign-in.
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<HTML")
  ) {
    throw new Error(
      "Google Apps Script Web App is not publicly accessible. Redeploy it with 'Who has access: Anyone' and use the active /exec URL."
    );
  }

  let result;

  try {
    result = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      "The SMOGCERT server returned an invalid response. Redeploy the Google Apps Script Web App and try again."
    );
  }

  if (result.code === "AUTH_REQUIRED") {
    logout();
    throw new Error("Session expired. Please log in again.");
  }

  return result;
}

async function login() {
  const username = $("loginUser").value.trim();
  const password = $("loginPass").value;

  $("loginError").textContent = "";

  if (!username || !password) {
    $("loginError").textContent = "Enter username and password.";
    return;
  }

  $("loginBtn").disabled = true;
  $("loginLoader").classList.add("show");

  try {
    const result = await apiPost("login", {username, password});
    if (!result.success) throw new Error(result.message || "Login failed.");

    sessionToken = result.token;
    sessionStorage.setItem(SESSION_KEY, sessionToken);
    $("loginPass").value = "";

    unlockUI();
    await loadVehicles();
  } catch (e) {
    lockUI(e.message);
  } finally {
    $("loginLoader").classList.remove("show");
    $("loginBtn").disabled = false;
  }
}

async function loadVehicles() {
  tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px">Loading Google Sheet data...</td></tr>';
  try {
    const result = await apiPost("getVehicles");
    if (!result.success) throw new Error(result.message || "Unable to load data.");
    vehicleData = Array.isArray(result.vehicles) ? result.vehicles : [];
    actionHistory = Array.isArray(result.history) ? result.history : [];
    updateDashboard();
    renderVehicles();
  } catch (e) {
    tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#dc2626;padding:30px">${escapeHtml(e.message)}</td></tr>`;
  }
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(text);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function calculateExpiry(timestamp, validUpto) {
  // New records may store the actual expiry date in Valid Upto.
  const directDate = parseDate(validUpto);
  if (directDate) return directDate;

  // Older records may store "6 month" / "1 year" in Valid Upto.
  const start = parseDate(timestamp);
  if (!start) return null;

  const text = String(validUpto || "").trim().toLowerCase();
  const expiry = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  if (text === "6 month" || text === "6 months" || text === "6m") {
    expiry.setMonth(expiry.getMonth() + 6);
    return expiry;
  }

  if (
    text === "1 year" || text === "1 years" ||
    text === "12 month" || text === "12 months" || text === "1y"
  ) {
    expiry.setFullYear(expiry.getFullYear() + 1);
    return expiry;
  }

  const monthMatch = text.match(/(\d+)\s*months?/);
  if (monthMatch) {
    expiry.setMonth(expiry.getMonth() + Number(monthMatch[1]));
    return expiry;
  }

  const yearMatch = text.match(/(\d+)\s*years?/);
  if (yearMatch) {
    expiry.setFullYear(expiry.getFullYear() + Number(yearMatch[1]));
    return expiry;
  }

  return null;
}

function daysLeftForVehicle(vehicle) {
  const expiry = calculateExpiry(vehicle.timestamp, vehicle.validUpto);
  if (!expiry) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expiry - today) / 86400000);
}

function formatExpiryForVehicle(vehicle) {
  const expiry = calculateExpiry(vehicle.timestamp, vehicle.validUpto);
  if (!expiry) return String(vehicle.validUpto || "—");
  return String(expiry.getDate()).padStart(2, "0") + "-" +
    String(expiry.getMonth() + 1).padStart(2, "0") + "-" +
    expiry.getFullYear();
}

function updateDashboard() {
  let expiringSevenDays = 0;
  let urgent = 0;
  let expired = 0;
  let expiredFiveDays = 0;
  let expiredFiveToTen = 0;
  let expiredOverTen = 0;

  // Latest row per registration number.
  const latestByReg = new Map();

  vehicleData.forEach(v => {
    const reg = normalizeReg(v.vehicleNumber);
    if (!reg) return;

    const current = latestByReg.get(reg);
    const vd = parseDate(v.timestamp) || new Date(0);
    const cd = current ? (parseDate(current.timestamp) || new Date(0)) : new Date(0);

    if (!current || vd >= cd) {
      latestByReg.set(reg, v);
    }
  });

  const latestVehicles = Array.from(latestByReg.values());

  // Active vehicle registration numbers.
  const activeRegs = new Set();

  latestVehicles.forEach(v => {
    const reg = normalizeReg(v.vehicleNumber);
    const lower = String(v.status || "Pending").trim().toLowerCase();

    if (lower !== "closed" && reg) {
      activeRegs.add(reg);
    }

    // Reminder counters include only vehicles still Pending.
    if (lower !== "pending") return;

    const days = daysLeftForVehicle(v);
    if (days === null) return;

    if (days < 0) {
      expired++;

      if (days >= -5) {
        expiredFiveDays++;
      } else if (days >= -10) {
        expiredFiveToTen++;
      } else {
        expiredOverTen++;
      }
    } else {
      // Separate upcoming ranges: 0–3 urgent, then 4–7 days.
      if (days <= 3) urgent++;
      else if (days <= 7) expiringSevenDays++;
    }
  });

  // History counters count every matching history action.
  let callDoneCount = 0;
  let cantConnectCount = 0;
  let closedCount = 0;

  actionHistory.forEach(h => {
    const status = String(h.status || "").trim();

    if (status === "Call Done") callDoneCount++;
    if (status === "Can't Connect") cantConnectCount++;
    if (status === "Closed") closedCount++;
  });

  // Include legacy Sheet1 actions if they do not already exist in ActionHistory.
  const historyKeys = new Set(
    actionHistory.map(h => [
      normalizeReg(h.vehicleNumber),
      String(h.status || "").trim(),
      String(h.actionDate || h.timestamp || ""),
      String(h.remarks || "").trim()
    ].join("|"))
  );

  vehicleData.forEach(v => {
    const status = String(v.status || "").trim();

    if (
      status !== "Call Done" &&
      status !== "Can't Connect" &&
      status !== "Closed"
    ) {
      return;
    }

    const key = [
      normalizeReg(v.vehicleNumber),
      status,
      String(v.callDate || v.timestamp || ""),
      String(v.remarks || "").trim()
    ].join("|");

    if (historyKeys.has(key)) return;

    if (status === "Call Done") callDoneCount++;
    if (status === "Can't Connect") cantConnectCount++;
    if (status === "Closed") closedCount++;
  });

  // Pending count = UNIQUE ACTIVE vehicles that have either
  // Call Done or Can't Connect history. Closed vehicles are excluded.
  const callHistoryVehicleRegs = new Set();

  actionHistory.forEach(h => {
    const status = String(h.status || "").trim();
    const reg = normalizeReg(h.vehicleNumber);

    if (
      reg &&
      activeRegs.has(reg) &&
      (status === "Call Done" || status === "Can't Connect")
    ) {
      callHistoryVehicleRegs.add(reg);
    }
  });

  vehicleData.forEach(v => {
    const status = String(v.status || "").trim();
    const reg = normalizeReg(v.vehicleNumber);

    if (
      reg &&
      activeRegs.has(reg) &&
      (status === "Call Done" || status === "Can't Connect")
    ) {
      callHistoryVehicleRegs.add(reg);
    }
  });

  if ($("totalVehicles")) $("totalVehicles").textContent = latestVehicles.length;
  if ($("expiringSevenDays")) $("expiringSevenDays").textContent = expiringSevenDays;
  if ($("urgentVehicles")) $("urgentVehicles").textContent = urgent;
  if ($("expiredVehicles")) $("expiredVehicles").textContent = expired;
  if ($("expiredFiveDays")) $("expiredFiveDays").textContent = expiredFiveDays;
  if ($("expiredFiveToTen")) $("expiredFiveToTen").textContent = expiredFiveToTen;
  if ($("expiredOverTen")) $("expiredOverTen").textContent = expiredOverTen;

  if ($("callDone")) $("callDone").textContent = callDoneCount;
  if ($("cantConnect")) $("cantConnect").textContent = cantConnectCount;
  if ($("closedVehicles")) $("closedVehicles").textContent = closedCount;
  if ($("callHistoryCount")) $("callHistoryCount").textContent = callHistoryVehicleRegs.size;

  // Pending count exactly matches the unique vehicles shown in Pending popup.
  const pendingRegs = new Set();
  getVehiclesForFilter("callHistory").forEach(v => {
    const reg = normalizeReg(v.vehicleNumber);
    if (reg) pendingRegs.add(reg);
  });
  if ($("callHistoryCount")) $("callHistoryCount").textContent = pendingRegs.size;

}



function maskPhone(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "—";

  // Keep only digits for normal phone numbers.
  const digits = raw.replace(/\D/g, "");

  if (!digits) return escapeHtml(raw);

  // Show only the final 4 digits, matching the existing dashboard style.
  if (digits.length <= 4) return digits;

  return "******" + digits.slice(-4);
}

window.maskPhone = maskPhone;

function expiryState(days) {
  if (days === null || days === undefined || Number.isNaN(days)) {
    return {
      label: "Unknown",
      badgeClass: "expiry-valid",
      daysClass: ""
    };
  }

  if (days < 0) {
    return {
      label: "Expired",
      badgeClass: "expiry-expired",
      daysClass: "days-expired"
    };
  }

  if (days <= 3) {
    return {
      label: "Urgent",
      badgeClass: "expiry-urgent",
      daysClass: "days-urgent"
    };
  }

  if (days <= 10) {
    return {
      label: "Due Soon",
      badgeClass: "expiry-due",
      daysClass: "days-due"
    };
  }

  return {
    label: "Valid",
    badgeClass: "expiry-valid",
    daysClass: "days-valid"
  };
}

function renderVehicles() {
  const searchEl = $("searchInput");
  const expiryEl = $("expiryFilter");
  const recordEl = $("recordFilter");

  const search = String(searchEl ? searchEl.value : "").trim().toLowerCase();
  const expiryFilter = expiryEl ? expiryEl.value : "all";
  const recordFilter = recordEl ? recordEl.value : "all";
  const heading = $("dataListHeading");

  const matchesSearch = v =>
    String(v.vehicleNumber || "").toLowerCase().includes(search) ||
    String(v.mobileNumber || "").toLowerCase().includes(search) ||
    String(v.vehicleName || "").toLowerCase().includes(search);

  const reminderFilter = v => {
    const status = String(v.status || "Pending").trim().toLowerCase();

    // Reminder list contains only Pending vehicles.
    if (status !== "pending") return false;

    const d = daysLeftForVehicle(v);

    // All expired + vehicles expiring within 10 days.
    return d !== null && d <= 10;
  };

  const sortReminderList = list => {
    list.sort((a, b) => {
      const da = daysLeftForVehicle(a);
      const db = daysLeftForVehicle(b);

      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;

      if (da >= 0 && db >= 0) return da - db;
      if (da >= 0 && db < 0) return -1;
      if (da < 0 && db >= 0) return 1;

      return db - da;
    });

    return list;
  };

  let list = [];
  let activeDisplayMode = currentView;

  // ---------------------------------------------------------
  // SEARCH PRIORITY
  // ---------------------------------------------------------
  if (search) {
    // FIRST: search only inside Expired & Soon Expiring.
    const reminderMatches = sortReminderList(
      vehicleData
        .filter(reminderFilter)
        .filter(matchesSearch)
    );

    if (reminderMatches.length) {
      list = reminderMatches;
      activeDisplayMode = "upcoming";
      if (heading) heading.textContent = "Expired & Soon Expiring";
    } else {
      // SECOND: if no reminder result, search all Vehicle Records.
      list = vehicleData.filter(matchesSearch);
      activeDisplayMode = "records";
      if (heading) heading.textContent = "Vehicle Records";
    }
  } else {
    // -------------------------------------------------------
    // NORMAL VIEW
    // -------------------------------------------------------
    if (currentView === "upcoming") {
      list = sortReminderList(
        vehicleData.filter(reminderFilter)
      );
      if (heading) heading.textContent = "Expired & Soon Expiring";
    } else {
      list = [...vehicleData];
      if (heading) heading.textContent = "Vehicle Records";
    }
  }

  // ---------------------------------------------------------
  // DROPDOWN FILTERS
  // ---------------------------------------------------------
  if (expiryFilter !== "all") {
    list = list.filter(v => {
      const days = daysLeftForVehicle(v);

      if (expiryFilter === "valid") {
        return days !== null && days > 10;
      }

      if (expiryFilter === "soon") {
        return days !== null && days >= 0 && days <= 10;
      }

      if (expiryFilter === "expired") {
        return days !== null && days < 0;
      }

      return true;
    });
  }

  if (recordFilter !== "all") {
    list = list.filter(v => {
      const status = String(v.status || "Pending").trim().toLowerCase();

      if (recordFilter === "pending") return status === "pending";
      if (recordFilter === "callDone") return status === "call done";
      if (recordFilter === "cantConnect") return status === "can't connect";
      if (recordFilter === "closed") return status === "closed";

      return true;
    });
  }

  totalFilteredRows = list.length;

  const totalPages = Math.max(1, Math.ceil(list.length / rowsPerPage));

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * rowsPerPage;
  const pageRows = list.slice(startIndex, startIndex + rowsPerPage);

  const body = $("tableBody");

  if (!pageRows.length) {
    body.innerHTML =
      `<tr><td colspan="9" style="text-align:center;padding:30px;color:#64748b;font-weight:800">
        ${search
          ? activeDisplayMode === "upcoming"
            ? "No matching expired or soon-expiring vehicles."
            : "No matching vehicle records found."
          : currentView === "upcoming"
            ? "No pending expired or soon-expiring vehicles."
            : "No vehicle records found."}
      </td></tr>`;

    updatePagination(0, 1);
    return;
  }

  body.innerHTML = pageRows.map(v => {
    const days = daysLeftForVehicle(v);
    const expiry = expiryState(days);
    const status = String(v.status || "Pending").trim();

    const daysText =
      days === null ? "—" :
      days < 0 ? `${Math.abs(days)} days ago` :
      days === 0 ? "Today" :
      `${days} days`;

    const statusLower = status.toLowerCase();

    const maskedPhone = (() => {
      const d = String(v.mobileNumber || "").replace(/\D/g, "");
      return d ? (d.length > 4 ? "******" + d.slice(-4) : d) : "—";
    })();

    return `<tr>
      <td data-label="Registration No"><strong>${escapeHtml(v.vehicleNumber || "")}</strong></td>
      <td data-label="Phone">${escapeHtml(maskedPhone)}</td>
      <td data-label="Vehicle Name">${escapeHtml(v.vehicleName || "")}</td>
      <td data-label="Fuel Type">${escapeHtml(v.fuelType || "")}</td>
      <td data-label="PUCC Expiry">${escapeHtml(formatExpiryForVehicle(v))}</td>
      <td data-label="Days Left" class="${expiry.daysClass}">${escapeHtml(daysText)}</td>
      <td data-label="Expiry Status"><span class="record-expiry ${expiry.badgeClass}">${escapeHtml(expiry.label)}</span></td>
      <td data-label="Record Status">${escapeHtml(status)}</td>
      <td data-label="Call">${statusLower === "closed"
        ? '<span class="closed-no-actions">🔒 Closed</span>'
        : `<button class="status-call-btn" onclick="window.openStatusUpdater(${Number(v.rowNumber)})">📞 Call</button>`}</td>
    </tr>`;
  }).join("");

  updatePagination(list.length, totalPages);
}

function updatePagination(totalItems, totalPages, from, to) {
  if ($("entriesInfo")) {
    $("entriesInfo").textContent = totalItems
      ? `Showing ${from} to ${to} of ${totalItems} entries`
      : "Showing 0 entries";
  }

  const box = $("pagination");
  if (!box) return;
  box.innerHTML = "";

  const add = (label, page, disabled=false, active=false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = "page-btn" + (active ? " active" : "");
    b.disabled = disabled;
    b.onclick = () => {
      currentPage = page;
      renderVehicles();
    };
    box.appendChild(b);
  };

  add("‹", currentPage - 1, currentPage <= 1);

  let pages = [];
  if (totalPages <= 5) {
    pages = Array.from({length:totalPages}, (_,i)=>i+1);
  } else {
    pages = [1];
    if (currentPage > 3) pages.push("...");
    const lo = Math.max(2, currentPage - 1);
    const hi = Math.min(totalPages - 1, currentPage + 1);
    for (let p = lo; p <= hi; p++) pages.push(p);
    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  pages.forEach(p => {
    if (p === "...") {
      const s = document.createElement("span");
      s.className = "page-ellipsis";
      s.textContent = "...";
      box.appendChild(s);
    } else {
      add(String(p), p, false, p === currentPage);
    }
  });

  add("›", currentPage + 1, currentPage >= totalPages);
}

let pendingRemarksAction = null;

function openRemarksAction(action, rowNumber) {
  const titles = {
    callDone: "📞 Call Done",
    cantConnect: "📵 Can't Connect",
    close: "🔒 Close Vehicle"
  };

  const helps = {
    callDone: "Add an optional remark before marking this call as done.",
    cantConnect: "Add an optional remark about the failed connection attempt.",
    close: "Add an optional closing remark. Closed vehicles will have no further actions."
  };

  pendingRemarksAction = { action, rowNumber };
  $("remarksActionTitle").textContent = titles[action] || "📝 Add Remarks";
  $("remarksActionHelp").textContent = helps[action] || "Enter remarks for this action.";
  $("remarksActionText").value = "";
  $("confirmRemarksAction").textContent =
    action === "close" ? "🔒 Close Vehicle" : "💾 Save";
  $("remarksActionModal").classList.add("show");
  setTimeout(() => $("remarksActionText").focus(), 60);
}

async function confirmRemarksAction() {
  if (!pendingRemarksAction) {
    return;
  }

  const action = pendingRemarksAction.action;
  const rowNumber = Number(pendingRemarksAction.rowNumber);
  const remarks = $("remarksActionText").value.trim();

  if (!rowNumber) {
    showSuccessMini("Invalid vehicle row.");
    return;
  }

  const button = $("confirmRemarksAction");
  const previousText = button.textContent;

  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const result = await apiPost(action, {
      rowNumber: rowNumber,
      remarks: remarks
    });

    if (!result || !result.success) {
      throw new Error(
        result && result.message
          ? result.message
          : "Could not save action."
      );
    }

    const originFilter = $("remarksActionModal").dataset.originFilter || "";
    const reopenFilter =
      originFilter === "callHistory"
        ? "callHistory"
        : action === "callDone" ? "callDone" :
          action === "cantConnect" ? "cantConnect" :
          action === "close" ? "closed" : "";

    $("remarksActionModal").classList.remove("show");
    pendingRemarksAction = null;

    await loadVehicles();

    showSuccessMini(
      result.message || "Action saved successfully."
    );

    if (reopenFilter) {
      $("successMiniModal").dataset.reopenFilter = reopenFilter;
    }

  } catch (e) {
    const message =
      e && e.message
        ? e.message
        : "Could not save action.";

    // Keep the remarks window open so the user can retry.
    alert(message);

  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

let statusUpdaterRowNumber = null;
let statusUpdaterSelectedAction = "";
let callLaunchLocked = false;

function normalizePhoneForTel(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}


function launchTelForVehicle(rowNumber) {
  const vehicle = vehicleData.find(v => Number(v.rowNumber) === Number(rowNumber));
  if (!vehicle) return;
  const telNumber = normalizePhoneForTel(vehicle.mobileNumber);
  if (!telNumber) {
    alert("No mobile number is saved for this vehicle.");
    return;
  }
  window.location.href = "tel:" + telNumber;
}

function setStatusUpdaterChoice(action) {
  statusUpdaterSelectedAction = action;
  document.querySelectorAll("#statusUpdaterModal .status-choice").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.statusAction === action);
  });
  const msg = document.getElementById("statusUpdaterMessage");
  if (msg) msg.textContent = "";
}


function openStatusUpdaterFromPending(rowNumber) {
  // Close Pending Vehicles first so no second modal can block Status Updater.
  hideMiniVehicleModal();

  // Open Status Updater on the next frame after Pending is fully hidden.
  requestAnimationFrame(() => {
    setTimeout(() => {
      openStatusUpdater(rowNumber);
    }, 30);
  });
}

window.openStatusUpdaterFromPending = openStatusUpdaterFromPending;

function openStatusUpdater(rowNumber) {
  if (callLaunchLocked) return;
  const row = Number(rowNumber);
  const vehicle = vehicleData.find(v => Number(v.rowNumber) === row);
  if (!vehicle) return;

  const modal = document.getElementById("statusUpdaterModal");
  if (!modal) return;

  callLaunchLocked = true;
  statusUpdaterRowNumber = row;
  statusUpdaterSelectedAction = "";

  const info = document.getElementById("statusUpdaterVehicle");
  if (info) {
    info.innerHTML = `
      <div class="status-updater-detail"><span>Vehicle Number</span><strong>${escapeHtml(vehicle.vehicleNumber || "—")}</strong></div>
      <div class="status-updater-detail"><span>Mobile Number</span><strong>${escapeHtml(vehicle.mobileNumber || "—")}</strong></div>`;
  }

  const remarks = document.getElementById("statusUpdaterRemarks");
  if (remarks) remarks.value = "";
  const msg = document.getElementById("statusUpdaterMessage");
  if (msg) msg.textContent = "";
  document.querySelectorAll("#statusUpdaterModal .status-choice").forEach(btn => btn.classList.remove("selected"));

  // Open popup first.
  modal.classList.add("show");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  if (window.syncModalStack) window.syncModalStack();

  // Then launch the device's registered calling app using the saved number.
  const telNumber = normalizePhoneForTel(vehicle.mobileNumber);
  setTimeout(() => {
    try {
      if (telNumber) window.location.href = "tel:" + telNumber;
    } finally {
      setTimeout(() => { callLaunchLocked = false; }, 900);
    }
  }, 300);
}

function closeStatusUpdater() {
  const modal = document.getElementById("statusUpdaterModal");
  if (modal) {
    modal.classList.remove("show");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }
  statusUpdaterRowNumber = null;
  statusUpdaterSelectedAction = "";
  callLaunchLocked = false;
}

async function saveStatusUpdater() {
  const rowNumber = Number(statusUpdaterRowNumber);
  const action = statusUpdaterSelectedAction;
  const remarks = String(document.getElementById("statusUpdaterRemarks")?.value || "").trim();
  const msg = document.getElementById("statusUpdaterMessage");
  const btn = document.getElementById("statusUpdaterSave");

  if (!rowNumber) { if (msg) msg.textContent = "Vehicle record is not available."; return; }
  if (!action) { if (msg) msg.textContent = "Select Call Done, Can't Connect or Close."; return; }
  if (btn && btn.disabled) return;

  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    const result = await apiPost(action, { rowNumber, remarks });
    if (!result || !result.success) throw new Error(result?.message || "Could not save status.");
    closeStatusUpdater();
    await loadVehicles();
    showSuccessMini(result.message || "Status saved successfully.");
  } catch (error) {
    if (msg) msg.textContent = error?.message || "Could not save status.";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "💾 Save"; }
  }
}

window.openStatusUpdater = openStatusUpdater;
window.closeStatusUpdater = closeStatusUpdater;
window.saveStatusUpdater = saveStatusUpdater;
window.launchTelForVehicle = launchTelForVehicle;
window.setStatusUpdaterChoice = setStatusUpdaterChoice;

window.addEventListener("focus", function () {
  if (!statusUpdaterRowNumber) return;
  const modal = document.getElementById("statusUpdaterModal");
  if (!modal) return;
  modal.classList.add("show");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  if (window.syncModalStack) window.syncModalStack();
});

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState !== "visible" || !statusUpdaterRowNumber) return;
  const modal = document.getElementById("statusUpdaterModal");
  if (!modal) return;
  modal.classList.add("show");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  if (window.syncModalStack) window.syncModalStack();
});


function markStatus(action, rowNumber) {
  openRemarksAction(action, rowNumber);
}

async function renewVehicle(rowNumber) {
  const choice = prompt("Enter new validity:\n1 = 6 month\n2 = 1 year", "2");
  if (choice === null) return;
  const newValidity = choice.trim() === "1" ? "6 month" : choice.trim() === "2" ? "1 year" : choice.trim().toLowerCase();
  if (!["6 month","1 year"].includes(newValidity)) return alert("Enter 1, 2, 6 month or 1 year.");
  const remarks = prompt("Remarks (optional):", "");
  if (remarks === null) return;
  const result = await apiPost("update", {rowNumber, newValidity, remarks});
  alert(result.message || "Saved.");
  if (result.success) await loadVehicles();
}

async function verifyRecordsPassword() {
  const password = prompt("Enter Records password:");
  if (password === null) return false;
  try {
    const result = await apiPost("verifySheetPassword", {password});
    if (!result.success) alert(result.message || "Incorrect password.");
    return !!result.success;
  } catch(e) { alert(e.message); return false; }
}


function normalizeVehicleNumber(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function findExistingVehicle(vehicleNumber) {
  const wanted = normalizeVehicleNumber(vehicleNumber);
  if (!wanted) return null;

  const matches = vehicleData.filter(v =>
    normalizeVehicleNumber(v.vehicleNumber) === wanted
  );

  if (!matches.length) return null;

  matches.sort((a,b) => {
    const da = parseDate(a.timestamp) || new Date(0);
    const db = parseDate(b.timestamp) || new Date(0);
    return db - da;
  });

  return matches[0];
}

function checkExistingVehicleNumber() {
  const input = $("newVehicleNumber");
  if (!input) return;

  const value = normalizeVehicleNumber(input.value);
  input.value = value;
  existingVehicleMatch = findExistingVehicle(value);

  const panel = $("existingVehiclePanel");
  const saveBtn = $("saveAdd");

  if (!existingVehicleMatch) {
    panel.style.display = "none";
    saveBtn.disabled = false;
    return;
  }

  $("existingVehicleNumber").textContent =
    existingVehicleMatch.vehicleNumber || "—";
  $("existingVehiclePhone").textContent =
    existingVehicleMatch.mobileNumber || "—";
  $("existingVehicleName").textContent =
    existingVehicleMatch.vehicleName || "—";
  $("existingVehicleExpiry").textContent =
    formatExpiryForVehicle(existingVehicleMatch);
  $("existingVehicleStatus").textContent =
    existingVehicleMatch.status || "Pending";

  panel.style.display = "block";
  saveBtn.disabled = true;

  // Keep the Edit / Update action clearly visible inside the Add Vehicle popup.
  setTimeout(() => {
    const editButton = $("editExistingVehicleBtn");
    if (editButton) {
      editButton.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  }, 80);
}


function openExistingVehicleEdit() {
  if (!existingVehicleMatch) return;
  $("addVehicleModal").classList.remove("show");

  $("editVehicleNumber").value = existingVehicleMatch.vehicleNumber || "";
  $("editMobile").value = existingVehicleMatch.mobileNumber || "";
  $("editVehicleName").value = existingVehicleMatch.vehicleName || "";
  $("editFuel").value = String(existingVehicleMatch.fuelType || "other").toLowerCase();
  if (!$("editFuel").value) $("editFuel").value = "other";
  $("editRemarks").value = existingVehicleMatch.remarks || "";
  $("editValidity").value = "keep";
  $("editVehicleMessage").textContent = "";
  $("editVehicleModal").dataset.rowNumber = existingVehicleMatch.rowNumber;
  updateEditExpiryPreview();
  $("saveEditVehicle").style.visibility = "visible";
  $("saveEditVehicle").style.display = "";
  $("editVehicleModal").classList.add("show");
}

function updateEditExpiryPreview() {
  const validity = $("editValidity").value;

  if (validity === "keep") {
    $("editExpiryPreview").value = existingVehicleMatch
      ? formatExpiryForVehicle(existingVehicleMatch)
      : "Current expiry";
    return;
  }

  const d = new Date();
  if (validity === "6 month") d.setMonth(d.getMonth() + 6);
  else if (validity === "1 year") d.setFullYear(d.getFullYear() + 1);

  $("editExpiryPreview").value =
    String(d.getDate()).padStart(2,"0") + "-" +
    String(d.getMonth()+1).padStart(2,"0") + "-" +
    d.getFullYear();
}

function showSuccessMini(message, title = "Saved Successfully") {
  $("successMiniTitle").textContent = title;
  $("successMiniText").textContent = message || "Vehicle details have been updated successfully.";
  $("successMiniModal").classList.add("show");
}

async function saveExistingVehicleEdit() {
  const rowNumber = Number($("editVehicleModal").dataset.rowNumber);
  const vehicleNumber = normalizeVehicleNumber($("editVehicleNumber").value);
  const mobileNumber = $("editMobile").value.trim();
  const vehicleName = $("editVehicleName").value.trim();
  const fuelType = $("editFuel").value;
  const validity = $("editValidity").value;
  const remarks = $("editRemarks").value.trim();
  const msg = $("editVehicleMessage");

  msg.textContent = "";
  if (!rowNumber) return;
  if (!vehicleNumber) { msg.textContent="Vehicle number is required."; return; }
  if (!/^\d{10}$/.test(mobileNumber)) { msg.textContent="Mobile number must be exactly 10 digits."; return; }
  if (!vehicleName) { msg.textContent="Vehicle name is required."; return; }

  $("saveEditVehicle").disabled = true;
  $("saveEditVehicle").textContent = "Saving...";
  try {
    const result = await apiPost("editVehicle", {
      rowNumber, vehicleNumber, mobileNumber, vehicleName, fuelType, validity, remarks
    });
    if (!result.success) throw new Error(result.message || "Could not edit vehicle.");
    await loadVehicles();
    $("editVehicleModal").classList.remove("show");
    showSuccessMini(result.message || "Vehicle details have been updated successfully.");
  } catch(e) {
    msg.textContent = e.message;
  } finally {
    $("saveEditVehicle").disabled = false;
    $("saveEditVehicle").textContent = "💾 Save Changes";
    $("saveEditVehicle").style.visibility = "visible";
    $("saveEditVehicle").style.display = "";
  }
}

function updateAddVehicleExpiryPreview() {
  const validity = $("newValidity").value;
  const d = new Date();

  if (validity === "6 month") d.setMonth(d.getMonth() + 6);
  else d.setFullYear(d.getFullYear() + 1);

  const text = String(d.getDate()).padStart(2,"0") + "-" +
    String(d.getMonth()+1).padStart(2,"0") + "-" +
    d.getFullYear();

  if ($("newVehicleExpiryPreview")) {
    $("newVehicleExpiryPreview").textContent = "Estimated expiry: " + text;
  }
}


function showExistingVehicleInline(vehicle) {
  if (vehicle) existingVehicleMatch = vehicle;

  const panel = $("existingVehiclePanel");
  const modal = $("addVehicleModal");

  if (panel) {
    panel.style.display = existingVehicleMatch ? "block" : "none";
    panel.classList.toggle("show", !!existingVehicleMatch);
  }

  if (modal) {
    modal.classList.add("show");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }

  if (existingVehicleMatch && panel) {
    setTimeout(() => {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }
}

async function saveNewVehicle() {
  const saveBtn = $("saveAdd");
  if (saveBtn && saveBtn.disabled) return;

  checkExistingVehicleNumber();

  if (existingVehicleMatch) {
    showExistingVehicleInline(existingVehicleMatch);
    return;
  }

  const vehicleNumber = $("newVehicleNumber").value.trim().toUpperCase();
  const mobileNumber = $("newMobile").value.trim();
  const vehicleName = $("newVehicleName").value.trim();
  const fuelType = $("newFuel").value;
  const validity = $("newValidity").value;
  const remarks = $("newRemarks").value.trim();

  if (!/^[A-Z0-9]+$/.test(vehicleNumber)) return alert("Vehicle number must contain only capital letters and numbers.");
  if (!/^\d{10}$/.test(mobileNumber)) return alert("Mobile number must be exactly 10 digits.");
  if (!vehicleName) return alert("Vehicle name is required.");

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.dataset.originalText = saveBtn.textContent;
    saveBtn.textContent = "Saving...";
  }

  try {
    const result = await apiPost("addVehicle", {
      vehicleNumber,
      mobileNumber,
      vehicleName,
      fuelType,
      validity,
      remarks
    });

    if (!result.success) {
      const msg = String(result.message || "");

      if (/already exists|existing vehicle|duplicate/i.test(msg)) {
        const match = findExistingVehicle(vehicleNumber);
        showExistingVehicleInline(match || existingVehicleMatch);
        return;
      }

      throw new Error(msg || "Could not add vehicle.");
    }

    $("addVehicleModal").classList.remove("show");
    ["newVehicleNumber","newMobile","newVehicleName","newRemarks"].forEach(id => $(id).value = "");
    $("existingVehiclePanel").style.display = "none";
    existingVehicleMatch = null;

    showSuccessMini("Vehicle added successfully.");
    await loadVehicles();

  } catch(e) {
    const msg = String(e && e.message ? e.message : "");

    if (/already exists|existing vehicle|duplicate/i.test(msg)) {
      const match = findExistingVehicle(vehicleNumber);
      showExistingVehicleInline(match || existingVehicleMatch);
      return;
    }

    const errorBox = $("addVehicleMessage");
    if (errorBox) {
      errorBox.textContent = msg || "Could not add vehicle.";
      errorBox.style.display = "block";
    } else {
      alert(msg || "Could not add vehicle.");
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = saveBtn.dataset.originalText || "💾 Save";
    }
  }
}

let passwordChangeType = "login";

function changePasswordFlow(type) {
  passwordChangeType = type;
  $("passwordModal").classList.remove("show");
  $("currentChangePassword").value = "";
  $("newChangePassword").value = "";
  $("confirmChangePassword").value = "";
  $("passwordChangeMessage").textContent = "";

  if (type === "login") {
    $("passwordChangeTitle").textContent = "🔑 Change Login Password";
    $("passwordChangeHelp").textContent = "Enter your existing login password and choose a new password.";
  } else {
    $("passwordChangeTitle").textContent = "🔒 Change Records Password";
    $("passwordChangeHelp").textContent = "Enter your existing Records password and choose a new password.";
  }

  $("passwordChangeModal").classList.add("show");
  setTimeout(() => $("currentChangePassword").focus(), 50);
}

async function savePasswordChange() {
  const currentPassword = $("currentChangePassword").value;
  const newPassword = $("newChangePassword").value;
  const confirmPassword = $("confirmChangePassword").value;
  const msg = $("passwordChangeMessage");

  msg.textContent = "";

  if (!currentPassword) {
    msg.textContent = "Enter the existing password.";
    return;
  }
  if (newPassword.length < 8) {
    msg.textContent = "New password must be at least 8 characters.";
    return;
  }
  if (newPassword !== confirmPassword) {
    msg.textContent = "New passwords do not match.";
    return;
  }

  const action = passwordChangeType === "login" ? "changePassword" : "changeRecordsPassword";
  $("savePasswordChange").disabled = true;
  $("savePasswordChange").textContent = "Saving...";

  try {
    const result = await apiPost(action, { currentPassword, newPassword });
    if (!result.success) throw new Error(result.message || "Password change failed.");

    msg.style.color = "#0a8f43";
    msg.textContent = result.message || "Password changed successfully.";

    setTimeout(() => {
      $("passwordChangeModal").classList.remove("show");
      msg.style.color = "#dc2626";
      if (passwordChangeType === "login") logout();
    }, 800);
  } catch (e) {
    msg.style.color = "#dc2626";
    msg.textContent = e.message;
  } finally {
    $("savePasswordChange").disabled = false;
    $("savePasswordChange").textContent = "Change Password";
  }
}

function hasHistoricalAction(vehicleNumber, actionStatus) {
  const reg = normalizeReg(vehicleNumber);
  return actionHistory.some(h =>
    normalizeReg(h.vehicleNumber) === reg &&
    String(h.status || "").trim() === actionStatus
  );
}

function isCurrentlyClosed(vehicleNumber) {
  const latest = latestVehicleRecord(vehicleNumber);
  return !!latest &&
    String(latest.status || "").trim().toLowerCase() === "closed";
}

function getAllStatusHistory(filterName) {
  const wantedStatus =
    filterName === "callDone" ? "Call Done" :
    filterName === "cantConnect" ? "Can't Connect" :
    filterName === "closed" ? "Closed" : "";

  if (!wantedStatus) return [];

  const saved = actionHistory
    .filter(h => String(h.status || "").trim() === wantedStatus)
    .map(h => ({
      timestamp: h.timestamp || "",
      callDate: h.actionDate || h.timestamp || "",
      vehicleNumber: h.vehicleNumber || "",
      mobileNumber: h.mobileNumber || "",
      vehicleName: "",
      fuelType: "",
      validUpto: "",
      status: wantedStatus,
      remarks: h.remarks || "",
      source: "history"
    }));

  const savedKeys = new Set(
    saved.map(h => [
      normalizeReg(h.vehicleNumber),
      String(h.status || ""),
      String(h.callDate || ""),
      String(h.remarks || "").trim()
    ].join("|"))
  );

  const legacy = vehicleData
    .filter(v => String(v.status || "").trim() === wantedStatus)
    .filter(v => {
      const key = [
        normalizeReg(v.vehicleNumber),
        wantedStatus,
        String(v.callDate || v.timestamp || ""),
        String(v.remarks || "").trim()
      ].join("|");
      return !savedKeys.has(key);
    })
    .map(v => ({
      timestamp: v.timestamp || "",
      callDate: v.callDate || v.timestamp || "",
      vehicleNumber: v.vehicleNumber || "",
      mobileNumber: v.mobileNumber || "",
      vehicleName: v.vehicleName || "",
      fuelType: v.fuelType || "",
      validUpto: v.validUpto || "",
      status: wantedStatus,
      remarks: v.remarks || "",
      source: "legacy"
    }));

  return [...saved, ...legacy].sort((a,b) => {
    const da = parseDate(a.callDate) || parseDate(a.timestamp) || new Date(0);
    const db = parseDate(b.callDate) || parseDate(b.timestamp) || new Date(0);
    return db - da;
  });
}

function latestDetailsForHistoryEntry(entry) {
  const latest = latestVehicleRecord(entry.vehicleNumber);

  return {
    ...entry,
    mobileNumber: entry.mobileNumber || (latest ? latest.mobileNumber : ""),
    vehicleName: entry.vehicleName || (latest ? latest.vehicleName : ""),
    fuelType: entry.fuelType || (latest ? latest.fuelType : ""),
    validUpto: entry.validUpto || (latest ? latest.validUpto : "")
  };
}

function renderStatusHistoryEntry(entry, index) {
  const v = latestDetailsForHistoryEntry(entry);

  const statusClass =
    v.status === "Call Done" ? "history-type-done" :
    v.status === "Can't Connect" ? "history-type-cant" :
    "history-type-closed";

  return `
    <article class="status-history-entry-card">
      <div class="status-history-entry-grid">
        <div class="status-history-item">
          <span class="status-history-icon shi-blue">🚗</span>
          <div><small>Vehicle Number</small><strong>${escapeHtml(String(v.vehicleNumber || "—").toUpperCase())}</strong></div>
        </div>

        <div class="status-history-item">
          <span class="status-history-icon shi-purple">📱</span>
          <div><small>Contact Number</small><strong>${escapeHtml(v.mobileNumber || "—")}</strong></div>
        </div>

        <div class="status-history-item">
          <span class="status-history-icon shi-teal">🚙</span>
          <div><small>Vehicle Name</small><strong>${escapeHtml(v.vehicleName || "—")}</strong></div>
        </div>

        <div class="status-history-item">
          <span class="status-history-icon shi-green">📅</span>
          <div><small>Action Date</small><strong>${escapeHtml(formatDisplayDate(v.callDate || v.timestamp))}</strong></div>
        </div>

        <div class="status-history-item">
          <span class="status-history-icon shi-yellow">⛽</span>
          <div><small>Fuel Type</small><strong>${escapeHtml(String(v.fuelType || "—").toUpperCase())}</strong></div>
        </div>

        <div class="status-history-item">
          <span class="status-history-icon shi-red">🗓️</span>
          <div><small>PUCC Expiry</small><strong>${escapeHtml(v.validUpto ? formatDisplayDate(v.validUpto) : "—")}</strong></div>
        </div>

        <div class="status-history-item">
          <span class="status-history-icon shi-orange">📄</span>
          <div><small>Status</small><strong class="${statusClass}">${escapeHtml(v.status)}</strong></div>
        </div>

        <div class="status-history-remark">
          <small>Remarks</small>
          <strong>${escapeHtml(String(v.remarks || "").trim() || "No remarks entered")}</strong>
        </div>
      </div>
    </article>`;
}

function getVehiclesForFilter(filterName) {
  return vehicleData.filter(v => {
    const status = String(v.status || "Pending").trim();
    const lower = status.toLowerCase();
    const days = daysLeftForVehicle(v);
    const closed = isCurrentlyClosed(v.vehicleNumber);

    if (filterName === "expiring7") {
      return lower === "pending" && days !== null && days >= 4 && days <= 7;
    }
    if (filterName === "urgent") {
      return lower === "pending" && days !== null && days >= 0 && days <= 3;
    }
    if (filterName === "expired") {
      return lower === "pending" && days !== null && days < 0;
    }

    // Once a vehicle has had this action, keep it in the list
    // until the vehicle is finally Closed.
    if (filterName === "callDone") {
      return !closed && (
        hasHistoricalAction(v.vehicleNumber, "Call Done") ||
        status === "Call Done"
      );
    }
    if (filterName === "cantConnect") {
      return !closed && (
        hasHistoricalAction(v.vehicleNumber, "Can't Connect") ||
        status === "Can't Connect"
      );
    }

    if (filterName === "closed") {
      return closed;
    }
    if (filterName === "callHistory") {
      return !closed && (
        hasHistoricalAction(v.vehicleNumber, "Call Done") ||
        hasHistoricalAction(v.vehicleNumber, "Can't Connect") ||
        status === "Call Done" ||
        status === "Can't Connect"
      );
    }
    if (filterName === "expired5") {
      return lower === "pending" && days !== null && days < 0 && days >= -5;
    }
    if (filterName === "expiredOlder") {
      return lower === "pending" && days !== null && days < -5 && days >= -10;
    }
    if (filterName === "expiredOver10") {
      return lower === "pending" && days !== null && days < -10;
    }
    return false;
  });
}

function formatDisplayDate(value) {
  const d = parseDate(value);
  if (!d) return String(value || "—");
  return String(d.getDate()).padStart(2,"0") + "-" +
    String(d.getMonth()+1).padStart(2,"0") + "-" +
    d.getFullYear();
}

function normalizeReg(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getVehicleHistory(vehicleNumber) {
  const reg = normalizeReg(vehicleNumber);

  // Permanent history created by V34+ backend.
  const saved = actionHistory
    .filter(h => normalizeReg(h.vehicleNumber) === reg)
    .map(h => ({
      timestamp: h.timestamp || "",
      callDate: h.actionDate || h.timestamp || "",
      vehicleNumber: h.vehicleNumber || vehicleNumber,
      mobileNumber: h.mobileNumber || "",
      status: h.status || "",
      remarks: h.remarks || ""
    }));

  // Older records already present in Sheet1 are also included.
  // This makes history visible for live vehicles as well as older ones.
  const legacy = vehicleData
    .filter(v => normalizeReg(v.vehicleNumber) === reg)
    .filter(v => {
      const status = String(v.status || "").trim();
      return status === "Call Done" ||
             status === "Can't Connect" ||
             status === "Closed" ||
             !!String(v.remarks || "").trim() ||
             !!String(v.callDate || "").trim();
    })
    .map(v => ({
      timestamp: v.timestamp || "",
      callDate: v.callDate || v.timestamp || "",
      vehicleNumber: v.vehicleNumber || vehicleNumber,
      mobileNumber: v.mobileNumber || "",
      status: v.status || "",
      remarks: v.remarks || ""
    }));

  const merged = [...saved, ...legacy];

  const seen = new Set();

  return merged
    .filter(h => {
      const key = [
        normalizeReg(h.vehicleNumber),
        String(h.callDate || h.timestamp || ""),
        String(h.status || ""),
        String(h.remarks || "")
      ].join("|");

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a,b) => {
      const da = parseDate(a.callDate) || parseDate(a.timestamp) || new Date(0);
      const db = parseDate(b.callDate) || parseDate(b.timestamp) || new Date(0);
      return db - da;
    });
}

function latestVehicleRecord(vehicleNumber) {
  const reg = normalizeReg(vehicleNumber);
  const matches = vehicleData
    .filter(v => normalizeReg(v.vehicleNumber) === reg)
    .sort((a,b) => {
      const da = parseDate(a.timestamp) || new Date(0);
      const db = parseDate(b.timestamp) || new Date(0);
      return db - da;
    });

  return matches[0] || null;
}

function historyDotClass(index) {
  return ["dot-green","dot-blue","dot-purple","dot-orange"][index % 4];
}

function renderStatusVehicleCard(vehicle, filterName) {
  const latest = latestVehicleRecord(vehicle.vehicleNumber) || vehicle;
  const history = getVehicleHistory(vehicle.vehicleNumber);
  const closed = String(latest.status || "").trim().toLowerCase() === "closed";

  const statusClass =
    String(latest.status || "").includes("Can't") ? "status-bad" : "status-good";

  const historyEntryHtml = (h, index) => `
    <div class="history-entry">
      <span class="history-dot ${historyDotClass(index)}"></span>
      <div class="history-entry-top">
        <div class="history-meta">
          <span class="history-date">${escapeHtml(formatDisplayDate(h.callDate || h.timestamp))}</span>
          <span class="history-sep">|</span>
          <span class="history-status ${
            String(h.status || "") === "Call Done"
              ? "history-type-done"
              : String(h.status || "") === "Can't Connect"
                ? "history-type-cant"
                : ""
          }">${escapeHtml(h.status || "Update")}</span>
        </div>
        <div class="history-remark">${escapeHtml(String(h.remarks || "").trim() || "No remarks entered")}</div>
      </div>
    </div>`;

  let historyHtml = '<div class="history-empty">No call history or remarks available for this vehicle.</div>';

  if (history.length) {
    const latestHistory = historyEntryHtml(history[0], 0);
    const olderHistory = history.slice(1);

    if (olderHistory.length) {
      const historyId = "olderHistory_" +
        normalizeReg(latest.vehicleNumber) + "_" +
        String(filterName || "history");

      historyHtml =
        latestHistory +
        `<button class="history-toggle" type="button"
          onclick="toggleOlderHistory('${historyId}', this)">
          <span class="history-toggle-arrow">▼</span>
          <span>Show ${olderHistory.length} Older ${olderHistory.length === 1 ? "History" : "Histories"}</span>
        </button>
        <div id="${historyId}" class="history-older-wrap">
          ${olderHistory.map((h,index) => historyEntryHtml(h,index + 1)).join("")}
        </div>`;
    } else {
      historyHtml = latestHistory;
    }
  }

  const actions = closed
    ? '<div class="history-closed-label">🔒 Closed — No further actions available</div>'
    : filterName === "callHistory"
      ? `<button class="pending-popup-call-btn" type="button"
           onclick="window.openStatusUpdaterFromPending(${Number(latest.rowNumber)})">📞 Call</button>`
      : "";

  return `
    <article class="vehicle-history-card ${filterName === "callHistory" ? "call-history-card" : ""}">
      <div class="vehicle-history-top">
        <div class="vehicle-info-grid">
          <div class="vehicle-info-item">
            <div class="vehicle-info-icon vi-blue">🚗</div>
            <div class="vehicle-info-text"><div class="vehicle-info-label">Vehicle Number</div><div class="vehicle-info-value">${escapeHtml(latest.vehicleNumber || "—")}</div></div>
          </div>
          <div class="vehicle-info-item">
            <div class="vehicle-info-icon vi-purple">👤</div>
            <div class="vehicle-info-text"><div class="vehicle-info-label">Contact Number</div><div class="vehicle-info-value">${escapeHtml(latest.mobileNumber || "—")}</div></div>
          </div>
          <div class="vehicle-info-item">
            <div class="vehicle-info-icon vi-teal">🚙</div>
            <div class="vehicle-info-text"><div class="vehicle-info-label">Vehicle Name</div><div class="vehicle-info-value">${escapeHtml(latest.vehicleName || "—")}</div></div>
          </div>
          <div class="vehicle-info-item">
            <div class="vehicle-info-icon vi-green">📞</div>
            <div class="vehicle-info-text"><div class="vehicle-info-label">Call / Action Date</div><div class="vehicle-info-value">${escapeHtml(formatDisplayDate(latest.callDate || latest.timestamp))}</div></div>
          </div>

          <div class="vehicle-info-item">
            <div class="vehicle-info-icon vi-violet">📅</div>
            <div class="vehicle-info-text"><div class="vehicle-info-label">Added Date</div><div class="vehicle-info-value">${escapeHtml(formatDisplayDate(latest.timestamp))}</div></div>
          </div>
          <div class="vehicle-info-item">
            <div class="vehicle-info-icon vi-yellow">⛽</div>
            <div class="vehicle-info-text"><div class="vehicle-info-label">Fuel Type</div><div class="vehicle-info-value">${escapeHtml(String(latest.fuelType || "—").toUpperCase())}</div></div>
          </div>
          <div class="vehicle-info-item">
            <div class="vehicle-info-icon vi-red">🗓️</div>
            <div class="vehicle-info-text"><div class="vehicle-info-label">PUCC Expiry</div><div class="vehicle-info-value">${escapeHtml(formatExpiryForVehicle(latest))}</div></div>
          </div>
          <div class="vehicle-info-item">
            <div class="vehicle-info-icon vi-orange">📄</div>
            <div class="vehicle-info-text"><div class="vehicle-info-label">Status</div><div class="vehicle-info-value ${statusClass}">${escapeHtml(latest.status || "Pending")}</div></div>
          </div>
        </div>
      </div>

      <div class="history-section">
        <div class="history-title">🕘 ${
          filterName === "callHistory"
            ? "Call Done & Can't Connect History / Remarks"
            : filterName === "cantConnect"
              ? "Can't Connect History / Remarks"
              : "Call Done History / Remarks"
        }</div>
        <div class="history-timeline">${historyHtml}</div>
      </div>

      ${actions ? `<div class="vehicle-history-actions">${actions}</div>` : ""}
    </article>`;
}


function showMiniVehicleModal() {
  const modal = document.getElementById("miniVehicleModal");
  if (!modal) return;

  modal.classList.add("show");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");

  if (window.syncModalStack) {
    setTimeout(() => window.syncModalStack(), 0);
  }
}

function hideMiniVehicleModal() {
  const modal = document.getElementById("miniVehicleModal");
  if (!modal) return;

  modal.classList.remove("show");
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");

  if (window.syncModalStack) {
    setTimeout(() => window.syncModalStack(), 0);
  }
}

window.showMiniVehicleModal = showMiniVehicleModal;
window.hideMiniVehicleModal = hideMiniVehicleModal;


function renderExpiryPopupTable(list) {
  if (!list.length) {
    return '<div class="history-empty">No vehicle details found.</div>';
  }

  const rows = [...list].sort((a, b) => {
    const da = daysLeftForVehicle(a);
    const db = daysLeftForVehicle(b);

    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  return `
    <div class="mini-table-wrap">
      <table class="mini-popup-table">
        <thead>
          <tr>
            <th>Registration No</th>
            <th>Phone</th>
            <th>Vehicle Name</th>
            <th>Fuel Type</th>
            <th>PUCC Expiry</th>
            <th>Days Left</th>
            <th>Expiry Status</th>
            <th>Record Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(v => {
            const days = daysLeftForVehicle(v);
            const expiry = expiryState(days);
            const daysText =
              days === null ? "—" :
              days < 0 ? Math.abs(days) + " days ago" :
              days === 0 ? "Today" :
              days + " days";

            return `<tr>
              <td><strong>${escapeHtml(String(v.vehicleNumber || "—").toUpperCase())}</strong></td>
              <td>${escapeHtml(v.mobileNumber || "—")}</td>
              <td>${escapeHtml(v.vehicleName || "—")}</td>
              <td>${escapeHtml(v.fuelType || "—")}</td>
              <td>${escapeHtml(formatExpiryForVehicle(v))}</td>
              <td class="${expiry.daysClass}"><strong>${escapeHtml(daysText)}</strong></td>
              <td><span class="record-expiry ${expiry.badgeClass}">${escapeHtml(expiry.label)}</span></td>
              <td>${escapeHtml(v.status || "Pending")}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderHistoryPopupTable(historyList) {
  if (!historyList.length) {
    return '<div class="history-empty">No history records found.</div>';
  }

  return `
    <div class="mini-table-wrap">
      <table class="mini-popup-table mini-history-table">
        <thead>
          <tr>
            <th>Registration No</th>
            <th>Phone</th>
            <th>Vehicle Name</th>
            <th>Fuel Type</th>
            <th>PUCC Expiry</th>
            <th>Action Date</th>
            <th>Remarks</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${historyList.map(entry => {
            const v = latestDetailsForHistoryEntry(entry);
            return `<tr>
              <td><strong>${escapeHtml(String(v.vehicleNumber || "—").toUpperCase())}</strong></td>
              <td>${escapeHtml(v.mobileNumber || "—")}</td>
              <td>${escapeHtml(v.vehicleName || "—")}</td>
              <td>${escapeHtml(v.fuelType || "—")}</td>
              <td>${escapeHtml(v.validUpto ? formatDisplayDate(v.validUpto) : "—")}</td>
              <td>${escapeHtml(formatDisplayDate(v.callDate || v.timestamp))}</td>
              <td class="mini-history-remarks">${escapeHtml(String(v.remarks || "").trim() || "No remarks entered")}</td>
              <td><strong>${escapeHtml(v.status || "—")}</strong></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function openMiniVehicleScreen(filterName) {
  const titles = {
    expiring7: "⏳ Expiring in 3–7 Days",
    urgent: "🚨 Urgent Vehicles",
    expired: "⛔ Expired Vehicles",
    callDone: "📞 Call Done",
    cantConnect: "📵 Can't Connect",
    closed: "🔒 Closed",
    callHistory: "🕘 Pending Vehicles",
    expired5: "🕔 Expired 1–5 Days Ago",
    expiredOlder: "📋 Expired 5–10 Days Ago",
    expiredOver10: "📋 Expired More Than 10 Days Ago"
  };

  $("miniVehicleTitle").textContent = titles[filterName] || "Vehicle Details";
  const cards = $("miniVehicleCards");

  // Call Done / Can't Connect / Closed:
  // show every saved action/history entry in old-style table format.
  if (
    filterName === "callDone" ||
    filterName === "cantConnect" ||
    filterName === "closed"
  ) {
    const historyList = getAllStatusHistory(filterName);

    $("miniVehicleSummary").textContent =
      historyList.length +
      (historyList.length === 1 ? " Record" : " Records");

    cards.innerHTML = renderHistoryPopupTable(historyList);

    $("miniVehicleModal").dataset.filterName = filterName;
    showMiniVehicleModal();
    return;
  }

  let list = getVehiclesForFilter(filterName);

  // Pending keeps the detailed old card/history/call workflow.
  if (filterName === "callHistory") {
    const seen = new Set();

    list = list.filter(v => {
      const reg = normalizeReg(v.vehicleNumber);
      if (!reg || seen.has(reg)) return false;
      seen.add(reg);
      return true;
    });

    $("miniVehicleSummary").textContent =
      list.length + (list.length === 1 ? " Vehicle" : " Vehicles");

    cards.innerHTML = list.length
      ? list.map(v => renderStatusVehicleCard(v, filterName)).join("")
      : '<div class="history-empty">No vehicle details found.</div>';

    $("miniVehicleModal").dataset.filterName = filterName;
    showMiniVehicleModal();
    return;
  }

  // Expiry-related icons use old-style table format.
  $("miniVehicleSummary").textContent =
    list.length + (list.length === 1 ? " Vehicle" : " Vehicles");

  cards.innerHTML = renderExpiryPopupTable(list);

  $("miniVehicleModal").dataset.filterName = filterName;
  showMiniVehicleModal();
}

function toggleOlderHistory(id, button) {
  const panel = document.getElementById(id);
  if (!panel) return;

  const opening = !panel.classList.contains("show");
  panel.classList.toggle("show", opening);
  button.classList.toggle("open", opening);

  const count = panel.querySelectorAll(".history-entry").length;
  const label = button.querySelector("span:last-child");

  if (label) {
    label.textContent = opening
      ? "Hide Older Call History"
      : "Show " + count + " Older " + (count === 1 ? "Call History" : "Call Histories");
  }
}

window.toggleOlderHistory = toggleOlderHistory;

function miniStatusAction(action, rowNumber) {
  const originFilter = $("miniVehicleModal").dataset.filterName || "";
  hideMiniVehicleModal();
  $("remarksActionModal").dataset.originFilter = originFilter;
  openRemarksAction(action, rowNumber);
}

function miniEditVehicle(rowNumber) {
  const vehicle = vehicleData.find(v => Number(v.rowNumber) === Number(rowNumber));
  if (!vehicle) {
    alert("Vehicle record not found.");
    return;
  }

  existingVehicleMatch = vehicle;
  hideMiniVehicleModal();
  openExistingVehicleEdit();
}

window.miniStatusAction = miniStatusAction;
window.miniEditVehicle = miniEditVehicle;

function setStatusFilter(filterName, button) {
  openMiniVehicleScreen(filterName);
}

function syncTopSearch() {
  if ($("topSearchInput")) $("topSearchInput").value = $("searchInput").value;
}

function openMobileSidebar() {
  if (!$("sidebar")) return;
  $("sidebar").classList.add("mobile-open");
  $("mobileOverlay").classList.add("show");
}

function closeMobileSidebar() {
  if (!$("sidebar")) return;
  $("sidebar").classList.remove("mobile-open");
  $("mobileOverlay").classList.remove("show");
}


function exportAllDataToExcel() {
  if (!vehicleData.length) {
    alert("No vehicle data available to export.");
    return;
  }
  if (typeof XLSX === "undefined") {
    alert("Excel export library did not load. Check the internet connection and try again.");
    return;
  }

  const rows = vehicleData.map(v => ({
    "Timestamp": v.timestamp || "",
    "Vehicle Number": v.vehicleNumber || "",
    "Mobile Number": v.mobileNumber || "",
    "Valid Upto": v.validUpto || "",
    "Vehicle Name": v.vehicleName || "",
    "Fuel Type": v.fuelType || "",
    "Status": v.status || "",
    "Call Date": v.callDate || "",
    "Remarks": v.remarks || ""
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    {wch:14},{wch:18},{wch:16},{wch:14},{wch:22},
    {wch:14},{wch:18},{wch:14},{wch:32}
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vehicle Records");

  const now = new Date();
  const stamp = now.getFullYear() +
    String(now.getMonth()+1).padStart(2,"0") +
    String(now.getDate()).padStart(2,"0");

  XLSX.writeFile(wb, `SMOGCERT_All_Vehicle_Data_${stamp}.xlsx`);
}





function hideTopSearchResults() {
  const box = document.getElementById("topSearchResults");
  if (!box) return;
  box.classList.remove("show");
  box.setAttribute("aria-hidden", "true");
}

function renderTopSearchResults(query) {
  const box = document.getElementById("topSearchResults");
  const body = document.getElementById("topSearchResultsBody");
  const count = document.getElementById("topSearchResultsCount");

  if (!box || !body) return;

  const q = String(query || "").trim().toLowerCase();

  if (!q) {
    hideTopSearchResults();
    body.innerHTML = '<tr><td colspan="3" class="top-search-empty">Start typing to search.</td></tr>';
    if (count) count.textContent = "0 results";
    return;
  }

  let rows = vehicleData.filter(v =>
    String(v.vehicleNumber || "").toLowerCase().includes(q) ||
    String(v.mobileNumber || "").toLowerCase().includes(q) ||
    String(v.vehicleName || "").toLowerCase().includes(q)
  );

  rows.sort((a, b) => {
    const da = parseDate(a.timestamp) || new Date(0);
    const db = parseDate(b.timestamp) || new Date(0);
    return db - da;
  });

  box.classList.add("show");
  box.setAttribute("aria-hidden", "false");

  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="3" class="top-search-empty">No matching vehicle records found.</td></tr>';
    if (count) count.textContent = "0 results";
    return;
  }

  // Keep the top search compact: show up to 20 best/current matches.
  const visibleRows = rows.slice(0, 20);

  body.innerHTML = visibleRows.map(v => {
    const days = daysLeftForVehicle(v);
    const expiry = expiryState(days);

    const daysText =
      days === null ? "—" :
      days < 0 ? Math.abs(days) + " days ago" :
      days === 0 ? "Today" :
      days + " days";

    return `<tr>
      <td class="top-search-reg"><strong>${escapeHtml(String(v.vehicleNumber || "—").toUpperCase())}</strong></td>
      <td class="top-search-expiry">${escapeHtml(formatExpiryForVehicle(v))}</td>
      <td class="top-search-status"><span class="record-expiry ${expiry.badgeClass}">${escapeHtml(expiry.label)}</span></td>
    </tr>`;
  }).join("");

  if (count) {
    count.textContent =
      rows.length + (rows.length === 1 ? " result" : " results") +
      (rows.length > 20 ? " — showing first 20" : "");
  }
}

window.renderTopSearchResults = renderTopSearchResults;
window.hideTopSearchResults = hideTopSearchResults;

function renderRecordsPopup() {
  const input = document.getElementById("recordsPopupSearch");
  const body = document.getElementById("recordsPopupBody");
  const count = document.getElementById("recordsPopupCount");

  if (!body) return;

  const q = String(input?.value || "").trim().toLowerCase();

  let rows = [...vehicleData];

  if (q) {
    rows = rows.filter(v =>
      String(v.vehicleNumber || "").toLowerCase().includes(q) ||
      String(v.mobileNumber || "").toLowerCase().includes(q) ||
      String(v.vehicleName || "").toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => {
    const da = parseDate(a.timestamp) || new Date(0);
    const db = parseDate(b.timestamp) || new Date(0);

    if (db.getTime() !== da.getTime()) {
      return db - da;
    }

    return String(a.vehicleNumber || "")
      .localeCompare(String(b.vehicleNumber || ""));
  });

  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="8" class="records-popup-empty">No matching vehicle records found.</td></tr>';
    if (count) count.textContent = "0 records";
    return;
  }

  body.innerHTML = rows.map(v => {
    const days = daysLeftForVehicle(v);
    const expiry = expiryState(days);

    const daysText =
      days === null ? "—" :
      days < 0 ? Math.abs(days) + " days ago" :
      days === 0 ? "Today" :
      days + " days";

    return `<tr>
      <td><strong>${escapeHtml(v.vehicleNumber || "—")}</strong></td>
      <td>${escapeHtml(v.mobileNumber || "—")}</td>
      <td>${escapeHtml(v.vehicleName || "—")}</td>
      <td>${escapeHtml(v.fuelType || "—")}</td>
      <td>${escapeHtml(formatExpiryForVehicle(v))}</td>
      <td class="${expiry.daysClass}">${escapeHtml(daysText)}</td>
      <td><span class="record-expiry ${expiry.badgeClass}">${escapeHtml(expiry.label)}</span></td>
      <td>${escapeHtml(v.status || "Pending")}</td>
    </tr>`;
  }).join("");

  if (count) {
    count.textContent = rows.length + (rows.length === 1 ? " record" : " records");
  }
}

window.renderRecordsPopup = renderRecordsPopup;

function openRecordsPanel() {
  const modal = document.getElementById("recordsPanelModal");
  if (!modal) return;

  modal.classList.add("show");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");

  const topSearch = document.getElementById("topSearchInput");
  const popupSearch = document.getElementById("recordsPopupSearch");

  if (popupSearch && topSearch && topSearch.value.trim()) {
    popupSearch.value = topSearch.value;
  }

  renderRecordsPopup();

  setTimeout(() => {
    document.getElementById("recordsPopupSearch")?.focus();
  }, 80);
}

function closeRecordsPanel() {
  const modal = document.getElementById("recordsPanelModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

window.openRecordsPanel = openRecordsPanel;
window.closeRecordsPanel = closeRecordsPanel;

function bindUI() {

  document.addEventListener("click", function (event) {
    const searchWrap = document.querySelector(".topbar .top-search");
    const results = document.getElementById("topSearchResults");

    if (
      results &&
      results.classList.contains("show") &&
      !results.contains(event.target) &&
      !(searchWrap && searchWrap.contains(event.target))
    ) {
      hideTopSearchResults();
    }
  });

  document.querySelectorAll("[data-open-records], .open-records-popup").forEach(btn => {
    if (btn.dataset.recordsBound === "1") return;
    btn.dataset.recordsBound = "1";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openRecordsPanel();
    });
  });
  if ($("recordsPanelBtn")) $("recordsPanelBtn").onclick = openRecordsPanel;
  if ($("recordsPanelClose")) $("recordsPanelClose").onclick = closeRecordsPanel;
  if ($("recordsPopupSearch")) {
    $("recordsPopupSearch").oninput = function () {
      if ($("topSearchInput")) $("topSearchInput").value = this.value;
      renderRecordsPopup();
    };
  }

  if ($("topSearchInput")) {
    let topSearchTimer = null;

    $("topSearchInput").oninput = function () {
      const value = String(this.value || "");
      clearTimeout(topSearchTimer);

      topSearchTimer = setTimeout(() => {
        renderTopSearchResults(value);
      }, 100);
    };

    $("topSearchInput").onkeydown = function (event) {
      if (event.key === "Escape") {
        hideTopSearchResults();
        this.blur();
      }
    };

    $("topSearchInput").onfocus = function () {
      if (String(this.value || "").trim()) {
        renderTopSearchResults(this.value);
      }
    };
  }

  if ($("recordsPopupRefresh")) {
    $("recordsPopupRefresh").onclick = async function () {
      if (this.disabled) return;

      this.disabled = true;
      this.classList.add("refreshing");

      try {
        if (typeof loadVehicles === "function") {
          await loadVehicles();
        }
        renderRecordsPopup();
      } finally {
        setTimeout(() => {
          this.disabled = false;
          this.classList.remove("refreshing");
        }, 500);
      }
    };
  }

  if ($("topRefreshBtn")) {
    $("topRefreshBtn").onclick = async function () {
      if (this.disabled) return;
      this.disabled = true;
      this.classList.add("refreshing");
      try {
        const existingRefresh = $("refreshBtn");
        if (existingRefresh) {
          existingRefresh.click();
        } else if (typeof loadVehicles === "function") {
          await loadVehicles();
        }
      } finally {
        setTimeout(() => {
          this.disabled = false;
          this.classList.remove("refreshing");
        }, 700);
      }
    };
  }


  $("loginBtn").onclick = login;
  $("closeRemarksAction").onclick = () => {
    $("remarksActionModal").classList.remove("show");
    $("remarksActionModal").dataset.originFilter = "";
    pendingRemarksAction = null;
  };
  $("cancelRemarksAction").onclick = () => {
    $("remarksActionModal").classList.remove("show");
    $("remarksActionModal").dataset.originFilter = "";
    pendingRemarksAction = null;
  };
  $("confirmRemarksAction").onclick = confirmRemarksAction;
  $("remarksActionModal").onclick = e => {
    if (e.target === $("remarksActionModal")) {
      $("remarksActionModal").classList.remove("show");
      pendingRemarksAction = null;
    }
  };
  if ($("mobileMenuBtn")) $("mobileMenuBtn").onclick = openMobileSidebar;
  if ($("mobileMenuClose")) $("mobileMenuClose").onclick = closeMobileSidebar;
  if ($("mobileOverlay")) $("mobileOverlay").onclick = closeMobileSidebar;

  if ($("mobileDashboardBtn")) $("mobileDashboardBtn").onclick = () => {
    closeMobileSidebar();
    window.scrollTo({top:0,behavior:"smooth"});
  };
  if ($("mobileAddBtn")) $("mobileAddBtn").onclick = async () => {
    $("addVehicleModal").classList.add("show");
    $("existingVehiclePanel").style.display = "none";
    $("saveAdd").disabled = false;
    existingVehicleMatch = null;
    updateAddVehicleExpiryPreview();

    try {
      const result = await apiPost("getVehicles");
      if (result.success) {
        vehicleData = Array.isArray(result.vehicles) ? result.vehicles : [];
        actionHistory = Array.isArray(result.history) ? result.history : actionHistory;
        updateDashboard();
        checkExistingVehicleNumber();
      }
    } catch (e) {
      console.error("Could not refresh data for duplicate check:", e);
    }
  };
  if ($("mobileRecordsBtn")) {
    $("mobileRecordsBtn").onclick = () => {
      closeMobileSidebar();
      openRecordsPanel();
    };
  }
  if ($("mobileRefreshBtn")) $("mobileRefreshBtn").onclick = loadVehicles;
  if ($("mobileMoreBtn")) $("mobileMoreBtn").onclick = openMobileSidebar;
  $("loginPass").onkeydown = e => { if (e.key === "Enter") login(); };
  $("topLogoutBtn").onclick = logout;
  $("refreshData").onclick = loadVehicles;

  if ($("expiryFilter")) $("expiryFilter").onchange = () => { currentPage = 1; renderVehicles(); };
  if ($("recordFilter")) $("recordFilter").onchange = () => { currentPage = 1; renderVehicles(); };
  if ($("clearFilters")) $("clearFilters").onclick = () => {
    if ($("searchInput")) $("searchInput").value = "";
    if ($("topSearchInput")) $("topSearchInput").value = "";
    if ($("expiryFilter")) $("expiryFilter").value = "all";
    if ($("recordFilter")) $("recordFilter").value = "all";
    currentPage = 1;
    renderVehicles();
  };
  if ($("searchInput")) $("searchInput").oninput = () => { currentPage = 1; syncTopSearch(); renderVehicles(); };

  $("upcomingView").onclick = () => {
    currentView = "upcoming";
    currentPage = 1;
    currentFilter = "";
    document.querySelectorAll(".status-filter").forEach(el => el.classList.remove("active-filter"));
    $("upcomingView").classList.add("active");
    $("vehicleRecordsView").classList.remove("active");
    $("pdfButton").style.display = "none";
    renderVehicles();
  };

  $("vehicleRecordsView").onclick = async () => {
    if (!(await verifyRecordsPassword())) return;
    currentView = "records";
    currentPage = 1;
    currentFilter = "";
    document.querySelectorAll(".status-filter").forEach(el => el.classList.remove("active-filter"));
    $("vehicleRecordsView").classList.add("active");
    $("upcomingView").classList.remove("active");
    $("pdfButton").style.display = "inline-block";
    renderVehicles();
  };

  $("pdfButton").onclick = exportAllDataToExcel;
  $("addVehicleBtn").onclick = async () => {
    $("addVehicleModal").classList.add("show");
    $("existingVehiclePanel").style.display = "none";
    $("saveAdd").disabled = false;
    existingVehicleMatch = null;
    updateAddVehicleExpiryPreview();

    try {
      const result = await apiPost("getVehicles");
      if (result.success) {
        vehicleData = Array.isArray(result.vehicles) ? result.vehicles : [];
        actionHistory = Array.isArray(result.history) ? result.history : actionHistory;
        updateDashboard();
        checkExistingVehicleNumber();
      }
    } catch (e) {
      console.error("Could not refresh data for duplicate check:", e);
    }
  };
  $("cancelAdd").onclick = () => $("addVehicleModal").classList.remove("show");
  $("closeAddVehicle").onclick = () => $("addVehicleModal").classList.remove("show");
  $("newValidity").onchange = updateAddVehicleExpiryPreview;
  $("newVehicleNumber").addEventListener("input", checkExistingVehicleNumber);
  $("newVehicleNumber").addEventListener("blur", checkExistingVehicleNumber);
  $("editExistingVehicleBtn").onclick = openExistingVehicleEdit;
  $("editValidity").onchange = updateEditExpiryPreview;
  $("closeEditVehicle").onclick = () => $("editVehicleModal").classList.remove("show");
  $("cancelEditVehicle").onclick = () => $("editVehicleModal").classList.remove("show");
  $("saveEditVehicle").onclick = saveExistingVehicleEdit;
  $("successMiniOk").onclick = () => {
    const reopenFilter = $("successMiniModal").dataset.reopenFilter || "";
    $("successMiniModal").classList.remove("show");
    $("successMiniModal").dataset.reopenFilter = "";

    if (reopenFilter) {
      openMiniVehicleScreen(reopenFilter);
    }
  };
  $("editVehicleModal").onclick = e => {
    if (e.target === $("editVehicleModal")) $("editVehicleModal").classList.remove("show");
  };
  $("saveAdd").onclick = saveNewVehicle;


  if ($("settingsBtn")) $("settingsBtn").onclick = () => $("passwordModal").classList.add("show");
  if ($("settingsRecordsBtn")) $("settingsRecordsBtn").onclick = async () => {
    if (await verifyRecordsPassword()) window.open(SHEET_URL, "_blank", "noopener");
  };
  $("cancelPassword").onclick = () => $("passwordModal").classList.remove("show");
  $("changeLoginPasswordBtn").onclick = () => changePasswordFlow("login");
  $("changeRecordsPasswordBtn").onclick = () => changePasswordFlow("records");
  $("cancelPasswordChange").onclick = () => $("passwordChangeModal").classList.remove("show");
  $("savePasswordChange").onclick = savePasswordChange;
  $("passwordChangeModal").onclick = e => {
    if (e.target === $("passwordChangeModal")) $("passwordChangeModal").classList.remove("show");
  };

  document.querySelectorAll(".status-filter").forEach(button => {
    button.onclick = () => setStatusFilter(button.dataset.filter, button);
  });

  $("closeMiniVehicle").onclick = () => hideMiniVehicleModal();
  $("miniVehicleModal").onclick = e => {
    if (e.target === $("miniVehicleModal")) hideMiniVehicleModal();
  };


  document.querySelectorAll(".sidebar .side-link").forEach(el => {
    el.addEventListener("click", () => {
      if (window.innerWidth <= 800) closeMobileSidebar();
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

window.markStatus = markStatus;
window.renewVehicle = renewVehicle;



document.addEventListener("DOMContentLoaded", function () {
  const saveBtn = document.getElementById("statusUpdaterSave");

  document.querySelectorAll("#statusUpdaterModal .status-choice").forEach(btn => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () {
      setStatusUpdaterChoice(this.dataset.statusAction || "");
    });
  });

  if (saveBtn && saveBtn.dataset.bound !== "1") {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", saveStatusUpdater);
  }

  // X and Call Again use direct inline handlers.
  // Clicking outside the popup intentionally does nothing.
});
/* V67 - simple single-popup lock */
(function () {
  function getVisibleModal() {
    const modals = Array.from(document.querySelectorAll(".modal.show"));
    return modals.length ? modals[modals.length - 1] : null;
  }

  function syncLock() {
    const active = getVisibleModal();
    document.documentElement.classList.toggle("popup-locked", !!active);
    document.body.classList.toggle("popup-locked", !!active);
  }

  const observer = new MutationObserver(syncLock);

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".modal").forEach(m => {
      observer.observe(m, {
        attributes: true,
        attributeFilter: ["class", "style"]
      });
    });
    syncLock();
  });

  window.syncModalStack = syncLock;
})();
