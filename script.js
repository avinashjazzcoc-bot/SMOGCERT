const API_URL = "https://script.google.com/macros/s/AKfycbyEzpHlOxi_ovC7WNvu08U_pT4Q0ryU5zM6lPxTdGbeHtXzEJK0zJikqbyuyrQenadvXQ/exec";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1S8a5kqVttJa7TSijjkEUzmL-F7rc039LHltu7rCi5j0/edit?gid=1544491919#gid=1544491919";
const SESSION_KEY = "smogcert_token";

let sessionToken = sessionStorage.getItem(SESSION_KEY) || "";
let vehicleData = [];
let currentView = "upcoming";
let currentFilter = "";
let currentPage = 1;
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
  if (action !== "login") params.set("token", sessionToken);
  Object.entries(data).forEach(([k,v]) => params.set(k, v == null ? "" : String(v)));

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
    body: params.toString(),
    cache: "no-store"
  });

  const result = await response.json();

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
  let active = 0, urgent = 0, expired = 0, expiredFiveDays = 0;
  let expiredOlderThanFive = 0, done = 0, cant = 0, closed = 0;

  vehicleData.forEach(v => {
    const status = String(v.status || "Pending").trim();
    const lower = status.toLowerCase();

    if (lower !== "closed") active++;
    if (status === "Call Done") done++;
    if (status === "Can't Connect") cant++;
    if (lower === "closed") closed++;

    if (lower === "closed") return;

    const days = daysLeftForVehicle(v);
    if (days === null) return;

    if (days < 0) {
      expired++;
      if (days >= -5) expiredFiveDays++;
      else expiredOlderThanFive++;
    } else if (days <= 3) {
      urgent++;
    }
  });

  if ($("totalVehicles")) $("totalVehicles").textContent = vehicleData.length;
  $("urgentVehicles").textContent = urgent;
  $("expiredVehicles").textContent = expired;
  $("expiredFiveDays").textContent = expiredFiveDays;
  $("expiredOlderThanFive").textContent = expiredOlderThanFive;
  $("callDone").textContent = done;
  $("cantConnect").textContent = cant;
  $("closedVehicles").textContent = closed;
}

function renderVehicles() {
  const search = $("searchInput").value.trim().toLowerCase();
  const expiryFilter = $("expiryFilter") ? $("expiryFilter").value : "all";
  const recordFilter = $("recordFilter") ? $("recordFilter").value : "all";
  let list = vehicleData.slice();

  if (search) {
    list = list.filter(v => [v.vehicleNumber,v.mobileNumber,v.vehicleName,v.fuelType]
      .join(" ").toLowerCase().includes(search));
  }

  if (expiryFilter !== "all") {
    list = list.filter(v => {
      const days = daysLeftForVehicle(v);
      if (expiryFilter === "valid") return days !== null && days > 10;
      if (expiryFilter === "soon") return days !== null && days >= 0 && days <= 10;
      if (expiryFilter === "urgent") return days !== null && days >= 0 && days <= 3;
      if (expiryFilter === "expired") return days !== null && days < 0;
      return true;
    });
  }

  if (recordFilter !== "all") {
    list = list.filter(v => String(v.status || "Pending").toLowerCase() === recordFilter.toLowerCase());
  }

  if (currentFilter) {
    list = list.filter(v => {
      const status = String(v.status || "Pending").trim();
      const lower = status.toLowerCase();
      const days = daysLeftForVehicle(v);

      if (currentFilter === "urgent") return lower !== "closed" && days !== null && days >= 0 && days <= 3;
      if (currentFilter === "expired") return lower !== "closed" && days !== null && days < 0;
      if (currentFilter === "callDone") return status === "Call Done";
      if (currentFilter === "cantConnect") return status === "Can't Connect";
      if (currentFilter === "closed") return lower === "closed";
      if (currentFilter === "expired5") return lower !== "closed" && days !== null && days < 0 && days >= -5;
      if (currentFilter === "expiredOlder") return lower !== "closed" && days !== null && days < -5;
      return true;
    });
    list.sort((a,b) => (daysLeftForVehicle(b) ?? -999999) - (daysLeftForVehicle(a) ?? -999999));
  } else if (!search && expiryFilter === "all" && recordFilter === "all" && currentView === "upcoming") {
    list = list.filter(v => {
      const lower = String(v.status || "").trim().toLowerCase();
      if (lower === "closed") return false;
      const d = daysLeftForVehicle(v);
      return d !== null && d <= 10;
    });
    list.sort((a,b) => (daysLeftForVehicle(b) ?? -999999) - (daysLeftForVehicle(a) ?? -999999));
  } else {
    list.sort((a,b) => {
      const da = parseDate(a.timestamp) || new Date(0);
      const db = parseDate(b.timestamp) || new Date(0);
      return db - da;
    });
  }

  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageList = list.slice(startIndex, startIndex + PAGE_SIZE);

  if (!pageList.length) {
    tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px">${search ? "No vehicle found." : "No vehicle records found."}</td></tr>`;
    updatePagination(totalItems, totalPages, 0, 0);
    return;
  }

  tableBody.innerHTML = pageList.map(v => {
    const d = daysLeftForVehicle(v);
    let label = "Valid", cls = "expiry-valid", daysCls = "days-valid";
    if (d !== null && d < 0) { label = "Expired"; cls = "expiry-expired"; daysCls = "days-expired"; }
    else if (d !== null && d <= 3) { label = "Urgent"; cls = "expiry-urgent"; daysCls = "days-urgent"; }
    else if (d !== null && d <= 10) { label = "Soon Expiring"; cls = "expiry-due"; daysCls = "days-due"; }

    const dayText = d === null ? "—" : d < 0 ? `${Math.abs(d)} days ago` : d === 0 ? "Today" : `${d} days`;

    return `<tr>
      <td data-label="Registration"><strong>${escapeHtml(v.vehicleNumber)}</strong></td>
      <td data-label="Phone">${escapeHtml(maskPhone(v.mobileNumber))}</td>
      <td data-label="Vehicle">${escapeHtml(v.vehicleName || "unknown")}</td>
      <td data-label="Fuel">${escapeHtml(v.fuelType || "unknown")}</td>
      <td data-label="PUCC Expiry">${escapeHtml(formatExpiryForVehicle(v))}</td>
      <td data-label="Days Left" class="${daysCls}">${dayText}</td>
      <td data-label="Expiry Status"><span class="record-expiry ${cls}">${label}</span></td>
      <td data-label="Record Status">${escapeHtml(v.status || "Pending")}</td>
      <td data-label="Actions"><div class="action-buttons">
        <button class="callDone" onclick="markStatus('callDone',${Number(v.rowNumber)})">Call Done</button>
        <button class="cantConnect" onclick="markStatus('cantConnect',${Number(v.rowNumber)})">Can't Connect</button>
        <button class="renew" onclick="renewVehicle(${Number(v.rowNumber)})">Renew</button>
        <button class="closeCase" onclick="markStatus('close',${Number(v.rowNumber)})">Close</button>
      </div></td>
    </tr>`;
  }).join("");

  updatePagination(totalItems, totalPages, startIndex + 1, Math.min(startIndex + PAGE_SIZE, totalItems));
}

function maskPhone(value) {
  const s = String(value || "");
  if (s.length <= 4) return s;
  return "*".repeat(Math.max(0, s.length - 4)) + s.slice(-4);
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

async function markStatus(action,rowNumber) {
  const remarks = prompt("Remarks (optional):", "");
  if (remarks === null) return;
  try {
    const result = await apiPost(action, {rowNumber, remarks});
    alert(result.message || "Saved.");
    if (result.success) await loadVehicles();
  } catch(e) { alert(e.message); }
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

async function saveNewVehicle() {
  const vehicleNumber = $("newVehicleNumber").value.trim().toUpperCase();
  const mobileNumber = $("newMobile").value.trim();
  const vehicleName = $("newVehicleName").value.trim();
  const fuelType = $("newFuel").value;
  const validity = $("newValidity").value;
  const remarks = $("newRemarks").value.trim();

  if (!/^[A-Z0-9]+$/.test(vehicleNumber)) return alert("Vehicle number must contain only capital letters and numbers.");
  if (!/^\d{10}$/.test(mobileNumber)) return alert("Mobile number must be exactly 10 digits.");
  if (!vehicleName) return alert("Vehicle name is required.");

  try {
    const result = await apiPost("addVehicle", {vehicleNumber,mobileNumber,vehicleName,fuelType,validity,remarks});
    if (!result.success) throw new Error(result.message || "Could not add vehicle.");
    $("addVehicleModal").classList.remove("show");
    ["newVehicleNumber","newMobile","newVehicleName","newRemarks"].forEach(id => $(id).value = "");
    alert(result.message || "Vehicle added.");
    await loadVehicles();
  } catch(e) { alert(e.message); }
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

function getVehiclesForFilter(filterName) {
  return vehicleData.filter(v => {
    const status = String(v.status || "Pending").trim();
    const lower = status.toLowerCase();
    const days = daysLeftForVehicle(v);

    if (filterName === "urgent") {
      return lower !== "closed" && days !== null && days >= 0 && days <= 3;
    }
    if (filterName === "expired") {
      return lower !== "closed" && days !== null && days < 0;
    }
    if (filterName === "callDone") {
      return status === "Call Done";
    }
    if (filterName === "cantConnect") {
      return status === "Can't Connect";
    }
    if (filterName === "closed") {
      return lower === "closed";
    }
    if (filterName === "expired5") {
      return lower !== "closed" && days !== null && days < 0 && days >= -5;
    }
    if (filterName === "expiredOlder") {
      return lower !== "closed" && days !== null && days < -5;
    }
    return [];
  });
}

function openMiniVehicleScreen(filterName) {
  const titles = {
    urgent: "🚨 Urgent Vehicles",
    expired: "⛔ Expired Vehicles",
    callDone: "✅ Call Done Vehicles",
    cantConnect: "📵 Can't Connect Vehicles",
    closed: "🔒 Closed Vehicles",
    expired5: "🕔 Expired 1–5 Days Ago",
    expiredOlder: "📋 Expired More Than 5 Days Ago"
  };

  let list = getVehiclesForFilter(filterName);

  list.sort((a, b) => {
    const da = daysLeftForVehicle(a);
    const db = daysLeftForVehicle(b);

    if (filterName === "callDone" || filterName === "cantConnect" || filterName === "closed") {
      const ta = parseDate(a.timestamp) || new Date(0);
      const tb = parseDate(b.timestamp) || new Date(0);
      return tb - ta;
    }

    return (db ?? -999999) - (da ?? -999999);
  });

  $("miniVehicleTitle").textContent = titles[filterName] || "Vehicle Details";
  $("miniVehicleSummary").textContent = list.length + (list.length === 1 ? " vehicle" : " vehicles");

  const body = $("miniVehicleBody");

  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px">No vehicle details found.</td></tr>';
  } else {
    body.innerHTML = list.map(v => {
      const days = daysLeftForVehicle(v);
      const dayText = days === null ? "—" :
        days < 0 ? Math.abs(days) + " days ago" :
        days === 0 ? "Today" :
        days + " days";

      return `<tr>
        <td data-label="Registration"><strong>${escapeHtml(v.vehicleNumber)}</strong></td>
        <td>${escapeHtml(v.mobileNumber)}</td>
        <td>${escapeHtml(v.vehicleName)}</td>
        <td data-label="PUCC Expiry">${escapeHtml(formatExpiryForVehicle(v))}</td>
        <td>${dayText}</td>
        <td data-label="Record Status">${escapeHtml(v.status || "Pending")}</td>
      </tr>`;
    }).join("");
  }

  $("miniVehicleModal").classList.add("show");
}

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

function bindUI() {
  $("loginBtn").onclick = login;
  if ($("mobileMenuBtn")) $("mobileMenuBtn").onclick = openMobileSidebar;
  if ($("mobileMenuClose")) $("mobileMenuClose").onclick = closeMobileSidebar;
  if ($("mobileOverlay")) $("mobileOverlay").onclick = closeMobileSidebar;

  if ($("mobileDashboardBtn")) $("mobileDashboardBtn").onclick = () => {
    closeMobileSidebar();
    window.scrollTo({top:0,behavior:"smooth"});
  };
  if ($("mobileAddBtn")) $("mobileAddBtn").onclick = () => {
    $("addVehicleModal").classList.add("show");
    updateAddVehicleExpiryPreview();
  };
  if ($("mobileRecordsBtn")) $("mobileRecordsBtn").onclick = async () => {
    if (!(await verifyRecordsPassword())) return;
    currentView = "records";
    currentPage = 1;
    $("vehicleRecordsView").classList.add("active");
    $("upcomingView").classList.remove("active");
    $("pdfButton").style.display = "inline-block";
    renderVehicles();
    window.scrollTo({top:document.querySelector(".filter-panel").offsetTop-70,behavior:"smooth"});
  };
  if ($("mobileRefreshBtn")) $("mobileRefreshBtn").onclick = loadVehicles;
  if ($("mobileMoreBtn")) $("mobileMoreBtn").onclick = openMobileSidebar;
  $("loginPass").onkeydown = e => { if (e.key === "Enter") login(); };
  $("topLogoutBtn").onclick = logout;
  $("refreshData").onclick = loadVehicles;
  if ($("topSearchInput")) {
    $("topSearchInput").oninput = () => {
      $("searchInput").value = $("topSearchInput").value;
      currentPage = 1;
      renderVehicles();
    };
  }
  if ($("expiryFilter")) $("expiryFilter").onchange = () => { currentPage = 1; renderVehicles(); };
  if ($("recordFilter")) $("recordFilter").onchange = () => { currentPage = 1; renderVehicles(); };
  if ($("clearFilters")) $("clearFilters").onclick = () => {
    $("searchInput").value = "";
    if ($("topSearchInput")) $("topSearchInput").value = "";
    $("expiryFilter").value = "all";
    $("recordFilter").value = "all";
    currentPage = 1;
    renderVehicles();
  };
  $("searchInput").oninput = () => { currentPage = 1; syncTopSearch(); renderVehicles(); };

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

  $("pdfButton").onclick = () => window.print();
  $("addVehicleBtn").onclick = () => { $("addVehicleModal").classList.add("show"); updateAddVehicleExpiryPreview(); };
  $("cancelAdd").onclick = () => $("addVehicleModal").classList.remove("show");
  $("closeAddVehicle").onclick = () => $("addVehicleModal").classList.remove("show");
  $("newValidity").onchange = updateAddVehicleExpiryPreview;
  $("saveAdd").onclick = saveNewVehicle;


  $("topChangePasswordBtn").onclick = () => $("passwordModal").classList.add("show");
  if ($("settingsBtn")) $("settingsBtn").onclick = () => $("passwordModal").classList.add("show");
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

  $("closeMiniVehicle").onclick = () => $("miniVehicleModal").classList.remove("show");
  $("miniVehicleModal").onclick = e => {
    if (e.target === $("miniVehicleModal")) $("miniVehicleModal").classList.remove("show");
  };

  $("sheetLink").onclick = async e => {
    e.preventDefault();
    closeMobileSidebar();
    if (await verifyRecordsPassword()) window.open(SHEET_URL, "_blank", "noopener");
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
