// ======================================================
// POLLUTION REMINDER SYSTEM - GOOGLE SHEETS VERSION
// Updated for:
// 6 month / 1 year validity periods
// Update creates a NEW record
// ======================================================

const API_URL =
"https://script.google.com/macros/s/AKfycbwBTQDO6XKogjzLnJfo-PQSUissGMED1WFVpGKQRaY400OL6N9ntfTQezavI9kpCOuMvA/exec";

const tableBody = document.getElementById("tableBody");

let vehicleData = [];
let currentView = "upcoming"; // upcoming = today/next 10 days/expired, all = every record

document.addEventListener("DOMContentLoaded", function () {
    setupRenewModal();
    setupSearch();
    loadVehicles();

    const refreshButton = document.getElementById("refreshData");
    if (refreshButton) {
        refreshButton.addEventListener("click", loadVehicles);
    }

    const upcomingButton = document.getElementById("upcomingView");
    const allButton = document.getElementById("vehicleRecordsView");
    const pdfButton = document.getElementById("pdfButton");

    if (upcomingButton) {
        upcomingButton.addEventListener("click", function () {
            currentView = "upcoming";
            updateViewButtons();
            renderFilteredVehicles();
        });
    }

    if (allButton) {
        allButton.addEventListener("click", function () {
            currentView = "all";
            updateViewButtons();
            renderFilteredVehicles();
        });
    }

    if (pdfButton) {
        pdfButton.addEventListener("click", saveAllDataAsPDF);
    }

    updateViewButtons();
});

async function loadVehicles() {
    if (!tableBody) return;

    tableBody.innerHTML = `
        <tr><td colspan="6" style="text-align:center;padding:25px;">
        Loading vehicles...
        </td></tr>`;

    try {
        const response = await fetch(
            API_URL + "?action=getVehicles&_=" + Date.now(),
            { cache: "no-store" }
        );

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || "Could not load data.");
        }

        vehicleData = result.vehicles || [];
        renderFilteredVehicles();
        updateDashboard(vehicleData);

    } catch (error) {
        console.error(error);

        tableBody.innerHTML = `
            <tr><td colspan="6" style="text-align:center;color:red;padding:25px;">
            Unable to load Google Sheet data.<br>
            ${escapeHtml(error.message)}
            </td></tr>`;
    }
}

function getVehicleValue(vehicle, names) {
    const keys = Object.keys(vehicle || {});

    for (const wanted of names) {
        const exact = keys.find(k =>
            String(k).trim().toLowerCase() ===
            String(wanted).trim().toLowerCase()
        );

        if (exact !== undefined &&
            vehicle[exact] !== undefined &&
            vehicle[exact] !== null &&
            String(vehicle[exact]).trim() !== "") {
            return vehicle[exact];
        }
    }

    return "";
}

function parseDate(value) {
    if (!value) return null;

    if (value instanceof Date && !isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }

    const text = String(value).trim();

    let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }

    m = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (m) {
        return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    }

    const d = new Date(text);
    if (!isNaN(d.getTime())) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    return null;
}

// Timestamp + validity period
function calculateExpiry(timestamp, validity) {
    const start = parseDate(timestamp);
    if (!start) return null;

    const text = String(validity || "").trim().toLowerCase();

    const expiry = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate()
    );

    if (
        text === "6 month" ||
        text === "6 months" ||
        text === "6m"
    ) {
        expiry.setMonth(expiry.getMonth() + 6);
        return expiry;
    }

    if (
        text === "1 year" ||
        text === "1 years" ||
        text === "12 month" ||
        text === "12 months" ||
        text === "1y"
    ) {
        expiry.setFullYear(expiry.getFullYear() + 1);
        return expiry;
    }

    const monthMatch = text.match(/(\d+)\s*months?/);
    if (monthMatch) {
        expiry.setMonth(
            expiry.getMonth() + Number(monthMatch[1])
        );
        return expiry;
    }

    const yearMatch = text.match(/(\d+)\s*years?/);
    if (yearMatch) {
        expiry.setFullYear(
            expiry.getFullYear() + Number(yearMatch[1])
        );
        return expiry;
    }

    return null;
}

function formatDate(value) {
    const d = value instanceof Date ? value : parseDate(value);
    if (!d) return "";

    return String(d.getDate()).padStart(2, "0") +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        d.getFullYear();
}

function getDaysLeft(expiry) {
    if (!expiry) return null;

    const now = new Date();
    const today = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
    );

    return Math.round((expiry - today) / 86400000);
}

function getExpiryState(days) {
    if (days === null) return { key: "unknown", label: "DATE ERROR", cls: "expiry-expired", daysClass: "days-expired" };
    if (days < 0) return { key: "expired", label: "EXPIRED", cls: "expiry-expired", daysClass: "days-expired" };
    if (days === 0) return { key: "urgent", label: "EXPIRES TODAY", cls: "expiry-urgent", daysClass: "days-today" };
    if (days <= 3) return { key: "urgent", label: "URGENT", cls: "expiry-urgent", daysClass: "days-urgent" };
    if (days <= 10) return { key: "due", label: "DUE SOON", cls: "expiry-due", daysClass: "days-due" };
    return { key: "valid", label: "VALID", cls: "expiry-valid", daysClass: "days-normal" };
}

function workflowBadge(status) {
    let cls = "workflow-badge";
    if (status === "Call Done") cls += " workflow-done";
    if (status === "Can't Connect") cls += " workflow-cant";
    if (status === "Closed") cls += " workflow-close";
    return `<span class="${cls}">${escapeHtml(status)}</span>`;
}

function normalizeVehicleNumber(value) {
    return String(value || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

function normalizeMobileNumber(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 10);
}

let currentSearchTerm = "";

function setupSearch() {
    const searchInput = document.getElementById("vehicleSearch");
    const clearButton = document.getElementById("clearSearch");

    if (!searchInput) return;

    searchInput.addEventListener("input", function () {
        currentSearchTerm = this.value.trim().toLowerCase();
        renderFilteredVehicles();
    });

    if (clearButton) {
        clearButton.addEventListener("click", function () {
            searchInput.value = "";
            currentSearchTerm = "";
            searchInput.focus();
            renderFilteredVehicles();
        });
    }
}

function vehicleMatchesSearch(vehicle, term) {
    if (!term) return true;

    const vehicleNumber = normalizeVehicleNumber(getVehicleValue(vehicle, [
        "vehicleNumber", "vehicle number", "Registration Number"
    ])).toLowerCase();

    const mobileNumber = normalizeMobileNumber(getVehicleValue(vehicle, [
        "mobileNumber", "mobile number", "Contact Number"
    ])).toLowerCase();

    const vehicleName = String(getVehicleValue(vehicle, [
        "vehicleName", "vehicle name"
    ]) || "").toLowerCase();

    return vehicleNumber.includes(term) ||
           mobileNumber.includes(term) ||
           vehicleName.includes(term);
}

function renderFilteredVehicles() {
    const filtered = vehicleData.filter(function (vehicle) {
        if (!vehicleMatchesSearch(vehicle, currentSearchTerm)) return false;

        if (currentView === "upcoming") {
            const timestamp = getVehicleValue(vehicle, ["timestamp", "Timestamp"]);
            const validity = getVehicleValue(vehicle, ["validUpto", "valid upto", "valid up to"]);
            const days = getDaysLeft(calculateExpiry(timestamp, validity));
            // Main screen: expired + today + next 10 days.
            if (days === null || days > 10) return false;
        }

        return true;
    });

    displayVehicles(filtered);

    const resultCount = document.getElementById("searchResultCount");
    if (resultCount) {
        if (currentSearchTerm) {
            resultCount.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"} found`;
        } else {
            resultCount.textContent = "";
        }
    }
}

function getTimestampMillis(vehicle) {
    const timestamp = getVehicleValue(vehicle, [
        "timestamp", "Timestamp", "date", "Date"
    ]);
    const date = parseDate(timestamp);
    return date ? date.getTime() : 0;
}

function displayVehicles(data) {
    if (!tableBody) return;
    tableBody.innerHTML = "";

    let count = 0;

    // Reminder view: nearest expiry first (expired/urgent first).
    // Vehicle Records: newest Google Sheet timestamp first.
    const sortedData = data.slice().sort(function (a, b) {
        if (currentView === "upcoming") {
            const ad = getExpiryInfo(a).days;
            const bd = getExpiryInfo(b).days;
            const av = ad === null ? Infinity : ad;
            const bv = bd === null ? Infinity : bd;
            if (av !== bv) return av - bv;
        }
        return getTimestampMillis(b) - getTimestampMillis(a);
    });

    sortedData.forEach(function (vehicle) {
        const vehicleNumber = normalizeVehicleNumber(getVehicleValue(vehicle, ["vehicleNumber", "vehicle number", "Registration Number"]));
        const mobileNumber = normalizeMobileNumber(getVehicleValue(vehicle, ["mobileNumber", "mobile number", "Contact Number"]));
        const timestamp = getVehicleValue(vehicle, ["timestamp", "Timestamp"]);
        const validity = getVehicleValue(vehicle, ["validUpto", "valid upto", "valid up to"]);
        const vehicleName = getVehicleValue(vehicle, ["vehicleName", "vehicle name"]);
        const fuelType = getVehicleValue(vehicle, ["fuelType", "fuel type"]);
        const status = String(getVehicleValue(vehicle, ["status", "Status"]) || "Pending");
        const rowNumber = Number(getVehicleValue(vehicle, ["rowNumber", "row number"]));

        const expiry = calculateExpiry(timestamp, validity);
        const days = getDaysLeft(expiry);
        const state = getExpiryState(days);

        count++;

        let daysText = "—";
        if (days !== null) {
            if (days < 0) daysText = `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago`;
            else if (days === 0) daysText = "TODAY";
            else daysText = `${days} ${days === 1 ? "day" : "days"}`;
        }

        const needsRenew = days !== null && days <= 10;
        const renewClass = needsRenew ? "renew-highlight" : "";

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>${escapeHtml(vehicleNumber)}</strong></td>
            <td>${escapeHtml(mobileNumber)}</td>
            <td>${expiry ? formatDate(expiry) : "—"}</td>
            <td class="${state.daysClass}">${daysText}</td>
            <td><span class="expiry-badge ${state.cls}">${state.label}</span></td>
            <td>${workflowBadge(status)}</td>
            <td>
                <div class="action-buttons">
                    <button class="callDone" type="button" onclick="markCallDone(${rowNumber})">Call Done</button>
                    <button class="cantConnect" type="button" onclick="markCantConnect(${rowNumber})">Can't Connect</button>
                    ${needsRenew ? `<button class="renewCase ${renewClass}" type="button" onclick="openRenewModal(${rowNumber})">🔄 Renew</button>` : `<button class="renewCase" type="button" onclick="openRenewModal(${rowNumber})">Renew</button>`}
                    <button class="closeCase" type="button" onclick="closeVehicle(${rowNumber})">Close</button>
                </div>
            </td>
        `;
        tableBody.appendChild(row);
    });

    if (count === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;">${currentView === "all" ? "No vehicle records found." : "No vehicles are due within the next 10 days or expired."}</td></tr>`;
    }
}

function updateViewButtons() {
    const upcoming = document.getElementById("upcomingView");
    const all = document.getElementById("vehicleRecordsView");
    const pdf = document.getElementById("pdfButton");
    const description = document.getElementById("tableDescription");

    if (upcoming) upcoming.classList.toggle("active", currentView === "upcoming");
    if (all) all.classList.toggle("active", currentView === "all");
    if (pdf) pdf.style.display = currentView === "all" ? "inline-block" : "none";
    if (description) {
        description.textContent = currentView === "all"
            ? "All vehicle records from Google Sheets. Use Save All Data as PDF to save the complete list."
            : "Showing today, next 10 days and expired vehicles automatically.";
    }
}

function saveAllDataAsPDF() {
    const printArea = document.getElementById("printArea");
    if (!printArea) return;

    const rows = vehicleData.map(function (vehicle) {
        const reg = normalizeVehicleNumber(getVehicleValue(vehicle, ["vehicleNumber", "vehicle number", "Registration Number"]));
        const mobile = normalizeMobileNumber(getVehicleValue(vehicle, ["mobileNumber", "mobile number", "Contact Number"]));
        const timestamp = getVehicleValue(vehicle, ["timestamp", "Timestamp"]);
        const validity = getVehicleValue(vehicle, ["validUpto", "valid upto", "valid up to"]);
        const name = getVehicleValue(vehicle, ["vehicleName", "vehicle name"]);
        const fuel = getVehicleValue(vehicle, ["fuelType", "fuel type"]);
        const status = getVehicleValue(vehicle, ["status", "Status"]) || "Pending";
        const callDate = getVehicleValue(vehicle, ["callDate", "call date"]);
        const remarks = getVehicleValue(vehicle, ["remarks", "Remarks"]);
        const expiry = calculateExpiry(timestamp, validity);
        const days = getDaysLeft(expiry);
        const state = getExpiryState(days);

        return {reg,mobile,name,fuel,validity,expiry,days,state,status,callDate,remarks};
    });

    let html = `
      <h1>SMOGCERT SOLUTIONS — Complete Vehicle Records</h1>
      <p>Generated: ${escapeHtml(formatDate(new Date()))} • Total records: ${rows.length}</p>
      <table>
        <thead><tr>
          <th>Registration No</th><th>Mobile</th><th>Vehicle Name</th><th>Fuel Type</th>
          <th>PUCC Validity</th><th>PUCC Expiry</th><th>Days Left</th><th>Expiry Status</th>
          <th>Work Status</th><th>Call Date</th><th>Remarks</th>
        </tr></thead><tbody>`;

    rows.forEach(function (r) {
        const daysText = r.days === null ? "—" : r.days < 0 ? Math.abs(r.days) + " overdue" : r.days === 0 ? "TODAY" : String(r.days);
        html += `<tr>
          <td>${escapeHtml(r.reg)}</td><td>${escapeHtml(r.mobile)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.fuel)}</td>
          <td>${escapeHtml(r.validity)}</td>
          <td>${escapeHtml(r.expiry ? formatDate(r.expiry) : "—")}</td><td>${escapeHtml(daysText)}</td><td>${escapeHtml(r.state.label)}</td>
          <td>${escapeHtml(r.status)}</td><td>${escapeHtml(formatDate(r.callDate) || "")}</td><td>${escapeHtml(r.remarks)}</td>
        </tr>`;
    });

    html += `</tbody></table>`;
    printArea.innerHTML = html;

    window.print();

    setTimeout(function () {
        printArea.innerHTML = "";
    }, 1000);
}


function statusBadge(status) {
    let cls = "status-pending";

    if (status === "Call Done") cls = "status-done";
    if (status === "Can't Connect") cls = "status-cant";
    if (status === "Closed") cls = "status-close";
    if (status === "Updated") cls = "status-updated";

    return `<span class="${cls}">${escapeHtml(status)}</span>`;
}

async function markCallDone(rowNumber) {
    const remarks = prompt("Remarks (optional):");
    if (remarks === null) return;

    await sendAction("callDone", {
        rowNumber: rowNumber,
        remarks: remarks
    });
}

async function markCantConnect(rowNumber) {
    const remarks = prompt("Reason / remarks (optional):");
    if (remarks === null) return;

    await sendAction("cantConnect", {
        rowNumber: rowNumber,
        remarks: remarks
    });
}

async function closeVehicle(rowNumber) {
    if (!confirm("Are you sure you want to close this reminder?")) {
        return;
    }

    const remarks = prompt("Closing remarks (optional):");
    if (remarks === null) return;

    await sendAction("close", {
        rowNumber: rowNumber,
        remarks: remarks
    });
}

// ======================================================
// UPDATE
// Creates NEW record with today's timestamp
// ======================================================

let renewalRowNumber = null;
let renewalVehicle = null;

function openRenewModal(rowNumber) {
    const vehicle = vehicleData.find(function (item) {
        return Number(getVehicleValue(item, ["rowNumber", "row number"])) === Number(rowNumber);
    });
    if (!vehicle) { alert("Vehicle record not found."); return; }

    renewalRowNumber = Number(rowNumber);
    renewalVehicle = vehicle;

    const vehicleNumber = getVehicleValue(vehicle, ["vehicleNumber", "vehicle number"]);
    const mobile = getVehicleValue(vehicle, ["mobileNumber", "mobile number"]);
    const timestamp = getVehicleValue(vehicle, ["timestamp", "Timestamp"]);
    const validity = getVehicleValue(vehicle, ["validUpto", "valid upto"]);
    const expiry = calculateExpiry(timestamp, validity);

    document.getElementById("renewVehicleNumber").textContent = vehicleNumber || "Vehicle";
    document.getElementById("renewVehicleInfo").textContent = `${mobile || ""}${expiry ? " • Current expiry: " + formatDate(expiry) : ""}`;
    document.getElementById("renewValidity").value = "6 month";
    document.getElementById("renewRemarks").value = "";
    updateRenewPreview();

    document.getElementById("renewModal").classList.add("show");
    document.getElementById("renewModal").setAttribute("aria-hidden", "false");
}

function closeRenewModal() {
    const modal = document.getElementById("renewModal");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    renewalRowNumber = null;
    renewalVehicle = null;
}

function calculateNewExpiry(validity) {
    const today = new Date();
    const expiry = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (validity === "6 month") expiry.setMonth(expiry.getMonth() + 6);
    else expiry.setFullYear(expiry.getFullYear() + 1);
    return expiry;
}

function updateRenewPreview() {
    const validity = document.getElementById("renewValidity").value;
    const expiry = calculateNewExpiry(validity);
    document.getElementById("renewPreview").textContent = "New PUCC expiry: " + formatDate(expiry);
}

async function confirmRenewal() {
    if (!renewalRowNumber) return;

    const validity = document.getElementById("renewValidity").value;
    const remarks = document.getElementById("renewRemarks").value.trim();
    const confirmButton = document.getElementById("renewConfirm");

    confirmButton.disabled = true;
    confirmButton.textContent = "Saving...";

    try {
        const expiry = calculateNewExpiry(validity);
        const expiryDate = expiry.getFullYear() + "-" + String(expiry.getMonth() + 1).padStart(2, "0") + "-" + String(expiry.getDate()).padStart(2, "0");

        await sendAction("update", {
            rowNumber: renewalRowNumber,
            newValidity: validity,
            newValidityDate: expiryDate,
            remarks: remarks
        });

        closeRenewModal();
    } finally {
        confirmButton.disabled = false;
        confirmButton.textContent = "✓ Confirm Renewal";
    }
}

function setupRenewModal() {
    const modal = document.getElementById("renewModal");
    if (!modal) return;
    document.getElementById("renewClose").addEventListener("click", closeRenewModal);
    document.getElementById("renewCancel").addEventListener("click", closeRenewModal);
    document.getElementById("renewConfirm").addEventListener("click", confirmRenewal);
    document.getElementById("renewValidity").addEventListener("change", updateRenewPreview);
    modal.addEventListener("click", function(e) { if (e.target === modal) closeRenewModal(); });
    document.addEventListener("keydown", function(e) { if (e.key === "Escape") closeRenewModal(); });
}

async function sendAction(action, data) {
    try {

        showMessage("Saving...");

        const params = new URLSearchParams();

        params.append("action", action);

        Object.keys(data).forEach(function (key) {
            params.append(
                key,
                data[key] == null ? "" : data[key]
            );
        });

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: params.toString()
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(
                result.message || "Save failed."
            );
        }

        showMessage(result.message || "Saved successfully.");

        await loadVehicles();

    } catch (error) {

        console.error(error);

        alert(
            "Could not save to Google Sheets.\n\n" +
            error.message
        );
    }
}

function updateDashboard(data) {
    let activeVehicles = 0, due = 0, urgent = 0, expired = 0, callDone = 0, cantConnect = 0;

    data.forEach(function (vehicle) {
        const status = String(getVehicleValue(vehicle, ["status", "Status"]) || "Pending").trim();
        const statusLower = status.toLowerCase();

        // "Valid Vehicles" means all active/non-closed vehicle records.
        if (statusLower === "closed") return;
        activeVehicles++;

        if (status === "Call Done") callDone++;
        if (status === "Can't Connect") cantConnect++;

        const timestamp = getVehicleValue(vehicle, ["timestamp", "Timestamp"]);
        const validity = getVehicleValue(vehicle, ["validUpto", "valid upto"]);
        const days = getDaysLeft(calculateExpiry(timestamp, validity));

        if (days === null) return;

        if (days < 0) {
            expired++;
        } else if (days <= 3) {
            urgent++;
        } else if (days <= 10) {
            due++;
        }
    });

    setText("totalVehicles", activeVehicles);
    setText("dueVehicles", due);
    setText("urgentVehicles", urgent);
    setText("expiredVehicles", expired);
    setText("callDone", callDone);
    setText("cantConnect", cantConnect);
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function showMessage(message) {
    const element = document.getElementById("message");
    if (!element) return;

    element.textContent = message;

    clearTimeout(window.__messageTimer);

    window.__messageTimer = setTimeout(function () {
        element.textContent = "";
    }, 2500);
}

function escapeHtml(value) {
    if (value === null || value === undefined) return "";

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.markCallDone = markCallDone;
window.markCantConnect = markCantConnect;
window.openRenewModal = openRenewModal;
window.closeVehicle = closeVehicle;
window.refreshVehicles = loadVehicles;



// ======================================================
// MANUAL ADD NEW VEHICLE
// ======================================================

function setupManualAddVehicle() {
  const toggle = document.getElementById("toggleAddVehicle");
  const form = document.getElementById("addVehicleForm");
  const cancel = document.getElementById("cancelAddVehicle");
  const validity = document.getElementById("newValidity");

  if (!toggle || !form) return;

  const vehicleNumberInput = document.getElementById("newVehicleNumber");
  const mobileNumberInput = document.getElementById("newMobileNumber");

  if (vehicleNumberInput) {
    vehicleNumberInput.addEventListener("input", function () {
      this.value = normalizeVehicleNumber(this.value);
    });
  }

  if (mobileNumberInput) {
    mobileNumberInput.setAttribute("maxlength", "10");
    mobileNumberInput.setAttribute("inputmode", "numeric");
    mobileNumberInput.addEventListener("input", function () {
      this.value = normalizeMobileNumber(this.value);
    });
  }

  toggle.addEventListener("click", function () {
    const open = form.style.display !== "none";
    form.style.display = open ? "none" : "block";
    toggle.textContent = open ? "➕ Add New Vehicle" : "✕ Close Add Vehicle";
  });

  if (cancel) {
    cancel.addEventListener("click", function () {
      form.reset();
      form.style.display = "none";
      toggle.textContent = "➕ Add New Vehicle";
      updateNewVehiclePreview();
    });
  }

  if (validity) {
    validity.addEventListener("change", updateNewVehiclePreview);
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const payload = {
      action: "addVehicle",
      vehicleNumber: normalizeVehicleNumber(document.getElementById("newVehicleNumber").value),
      mobileNumber: normalizeMobileNumber(document.getElementById("newMobileNumber").value),
      vehicleName: document.getElementById("newVehicleName").value.trim(),
      fuelType: document.getElementById("newFuelType").value.trim(),
      newValidity: document.getElementById("newValidity").value.trim(),
      remarks: document.getElementById("newRemarks").value.trim()
    };

    if (!payload.vehicleNumber || !payload.mobileNumber || !payload.newValidity) {
      alert("Please enter Registration Number, Mobile Number and PUCC Validity.");
      return;
    }

    if (!/^[A-Z0-9]+$/.test(payload.vehicleNumber)) {
      alert("Registration Number can contain only capital letters (A-Z) and numbers (0-9).");
      return;
    }

    if (!/^\d{10}$/.test(payload.mobileNumber)) {
      alert("Mobile Number must contain exactly 10 digits.");
      return;
    }

    const button = form.querySelector(".save-new-btn");
    if (button) {
      button.disabled = true;
      button.textContent = "Saving...";
    }

    try {
      let result;

      // Use the website's existing sendAction() when available.
      if (typeof sendAction === "function") {
        result = await sendAction("addVehicle", payload);
      } else {
        // Fallback: use the existing API URL if the site exposes one.
        const api =
          (typeof API_URL !== "undefined" && API_URL) ||
          (typeof SCRIPT_URL !== "undefined" && SCRIPT_URL) ||
          (typeof WEB_APP_URL !== "undefined" && WEB_APP_URL);

        if (!api) {
          throw new Error("Google Apps Script URL was not found in this website.");
        }

        const params = new URLSearchParams(payload);
        const response = await fetch(api + "?" + params.toString());
        result = await response.json();
      }

      if (result && result.success === false) {
        throw new Error(result.message || "Could not save vehicle.");
      }

      alert("Vehicle added successfully.");
      form.reset();
      form.style.display = "none";
      toggle.textContent = "➕ Add New Vehicle";
      updateNewVehiclePreview();

      if (typeof loadVehicles === "function") {
        await loadVehicles();
      } else if (typeof fetchVehicles === "function") {
        await fetchVehicles();
      }

    } catch (error) {
      console.error(error);
      alert("Could not add vehicle.\n\n" + error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "💾 Save Vehicle";
      }
    }
  });
}

function updateNewVehiclePreview() {
  const preview = document.getElementById("newVehiclePreview");
  const validity = document.getElementById("newValidity");
  if (!preview || !validity) return;

  if (!validity.value) {
    preview.textContent = "";
    return;
  }

  const today = new Date();
  const expiry = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  if (validity.value === "6 month") {
    expiry.setMonth(expiry.getMonth() + 6);
  } else if (validity.value === "1 year") {
    expiry.setFullYear(expiry.getFullYear() + 1);
  }

  const fmt = (d) =>
    String(d.getDate()).padStart(2, "0") + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    d.getFullYear();

  preview.textContent =
    "Today: " + fmt(today) + "  |  PUCC Expiry: " + fmt(expiry);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupManualAddVehicle);
} else {
  setupManualAddVehicle();
}
