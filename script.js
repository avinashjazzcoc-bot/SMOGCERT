// ======================================================
// POLLUTION REMINDER SYSTEM - GOOGLE SHEETS VERSION
// Updated for:
// 6 month / 1 year validity periods
// Update creates a NEW record
// ======================================================

const API_URL =
"https://script.google.com/macros/s/AKfycbwBTQDO6XKogjzLnJfo-PQSUissGMED1WFVpGKQRaY400OL6N9ntfTQezavI9kpCOuMvA/exec";

const tableBody = document.getElementById("tableBody");
const searchInput = document.getElementById("searchInput");

let vehicleData = [];

document.addEventListener("DOMContentLoaded", function () {
    loadVehicles();

    if (searchInput) {
        searchInput.addEventListener("input", function () {
            displayVehicles(vehicleData);
        });
    }

    const refreshButton = document.getElementById("refreshData");
    if (refreshButton) {
        refreshButton.addEventListener("click", loadVehicles);
    }
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
        displayVehicles(vehicleData);
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

function displayVehicles(data) {
    if (!tableBody) return;

    tableBody.innerHTML = "";

    const search = searchInput
        ? searchInput.value.trim().toLowerCase()
        : "";

    let count = 0;

    data.forEach(function (vehicle) {

        const vehicleNumber = getVehicleValue(vehicle, [
            "vehicleNumber",
            "vehicle number",
            "Registration Number"
        ]);

        const mobileNumber = getVehicleValue(vehicle, [
            "mobileNumber",
            "mobile number",
            "Contact Number"
        ]);

        const timestamp = getVehicleValue(vehicle, [
            "timestamp",
            "Timestamp"
        ]);

        const validity = getVehicleValue(vehicle, [
            "validUpto",
            "valid upto",
            "valid up to"
        ]);

        const vehicleName = getVehicleValue(vehicle, [
            "vehicleName",
            "vehicle name"
        ]);

        const fuelType = getVehicleValue(vehicle, [
            "fuelType",
            "fuel type"
        ]);

        const status = String(
            getVehicleValue(vehicle, ["status", "Status"]) ||
            "Pending"
        );

        const rowNumber = Number(
            getVehicleValue(vehicle, [
                "rowNumber",
                "row number"
            ])
        );

        const searchable =
            `${vehicleNumber} ${mobileNumber} ${vehicleName} ${fuelType}`
            .toLowerCase();

        if (search && !searchable.includes(search)) return;

        // When there is no search, show only records due in next 10 days
        if (!search) {
            const expiry = calculateExpiry(timestamp, validity);
            const days = getDaysLeft(expiry);

            if (
                status === "Closed" ||
                status === "Call Done" ||
                status === "Updated"
            ) return;

            if (days === null || days < 0 || days > 10) return;
        }

        count++;

        const expiry = calculateExpiry(timestamp, validity);
        const days = getDaysLeft(expiry);

        let daysText = "—";
        let daysClass = "";

        if (days !== null) {
            if (days < 0) {
                daysText = "EXPIRED";
                daysClass = "days-expired";
            } else if (days === 0) {
                daysText = "TODAY";
                daysClass = "days-today";
            } else {
                daysText = days + (days === 1 ? " day" : " days");
                daysClass = days <= 3
                    ? "days-warning"
                    : "days-normal";
            }
        }

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHtml(vehicleNumber)}</td>
            <td>${escapeHtml(mobileNumber)}</td>
            <td>${expiry ? formatDate(expiry) : "—"}</td>
            <td class="${daysClass}">${daysText}</td>
            <td>${statusBadge(status)}</td>
            <td>
                <div class="action-buttons">
                    <button class="callDone" type="button"
                        onclick="markCallDone(${rowNumber})">
                        Call Done
                    </button>

                    <button class="cantConnect" type="button"
                        onclick="markCantConnect(${rowNumber})">
                        Can't Connect
                    </button>

                    <button class="updateCase" type="button"
                        onclick="updateVehicle(${rowNumber})">
                        Update
                    </button>

                    <button class="closeCase" type="button"
                        onclick="closeVehicle(${rowNumber})">
                        Close
                    </button>
                </div>
            </td>
        `;

        tableBody.appendChild(row);
    });

    if (count === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center;padding:30px;">
                ${search
                    ? "No vehicle found."
                    : "No vehicles are due within the next 10 days."}
                </td>
            </tr>`;
    }
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

async function updateVehicle(rowNumber) {

    const vehicle = vehicleData.find(function (item) {
        return Number(
            getVehicleValue(item, ["rowNumber", "row number"])
        ) === Number(rowNumber);
    });

    if (!vehicle) {
        alert("Vehicle record not found.");
        return;
    }

    const vehicleNumber = getVehicleValue(vehicle, [
        "vehicleNumber",
        "vehicle number"
    ]);

    const choice = prompt(
        "Vehicle: " + vehicleNumber +
        "\n\nEnter new PUCC validity:\n\n" +
        "1 = 6 month\n" +
        "2 = 1 year"
    );

    if (choice === null) return;

    let newValidity = "";

    if (
        choice.trim() === "1" ||
        choice.trim().toLowerCase() === "6 month"
    ) {
        newValidity = "6 month";
    } else if (
        choice.trim() === "2" ||
        choice.trim().toLowerCase() === "1 year"
    ) {
        newValidity = "1 year";
    } else {
        alert("Please enter 1 for 6 month or 2 for 1 year.");
        return;
    }

    const remarks = prompt("Update remarks (optional):");
    if (remarks === null) return;

    // Calculate today's new expiry date.
    // This is sent too, but the Google Apps Script stores
    // the validity period in the "valid upto" column.
    const today = new Date();

    const expiry = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
    );

    if (newValidity === "6 month") {
        expiry.setMonth(expiry.getMonth() + 6);
    } else {
        expiry.setFullYear(expiry.getFullYear() + 1);
    }

    const expiryDate =
        expiry.getFullYear() + "-" +
        String(expiry.getMonth() + 1).padStart(2, "0") + "-" +
        String(expiry.getDate()).padStart(2, "0");

    await sendAction("update", {
        rowNumber: rowNumber,
        newValidity: newValidity,
        newValidityDate: expiryDate,
        remarks: remarks
    });
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
    let due = 0;
    let callDone = 0;
    let cantConnect = 0;

    data.forEach(function (vehicle) {

        const status = String(
            getVehicleValue(vehicle, ["status", "Status"]) ||
            "Pending"
        );

        if (status === "Call Done") callDone++;
        if (status === "Can't Connect") cantConnect++;

        const timestamp = getVehicleValue(vehicle, [
            "timestamp",
            "Timestamp"
        ]);

        const validity = getVehicleValue(vehicle, [
            "validUpto",
            "valid upto"
        ]);

        const expiry = calculateExpiry(timestamp, validity);
        const days = getDaysLeft(expiry);

        if (
            status !== "Closed" &&
            status !== "Call Done" &&
            status !== "Updated" &&
            days !== null &&
            days >= 0 &&
            days <= 10
        ) {
            due++;
        }
    });

    setText("totalVehicles", data.length);
    setText("dueVehicles", due);
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
window.updateVehicle = updateVehicle;
window.closeVehicle = closeVehicle;
window.refreshVehicles = loadVehicles;


// ===== Add New Vehicle / UI actions =====
document.addEventListener('DOMContentLoaded',function(){
 const b=document.getElementById('addVehicleBtn'),m=document.getElementById('addVehicleModal'),c=document.getElementById('cancelAdd'),s=document.getElementById('saveAdd');
 if(b)b.onclick=()=>m&&m.classList.add('show'); if(c)c.onclick=()=>m&&m.classList.remove('show');
 if(s)s.onclick=saveNewVehicle;
 const cp=document.getElementById('changePasswordBtn'); if(cp)cp.onclick=()=>alert('For stronger security, change the server-side password in your Google Apps Script. The current login password is ASDF@321.');
});
async function saveNewVehicle(){
 const vn=(document.getElementById('newVehicleNumber').value||'').trim().toUpperCase();
 const mob=(document.getElementById('newMobile').value||'').trim();
 const name=(document.getElementById('newVehicleName').value||'').trim();
 const fuel=document.getElementById('newFuel').value; const validity=document.getElementById('newValidity').value;
 if(!/^[A-Z0-9]+$/.test(vn)){alert('Vehicle number: capital letters and numbers only.');return}
 if(!/^\d{10}$/.test(mob)){alert('Mobile number must be exactly 10 digits.');return}
 if(!name){alert('Enter vehicle name.');return}
 try{
   const p=new URLSearchParams({action:'add',vehicleNumber:vn,mobileNumber:mob,vehicleName:name,fuelType:fuel,validUpto:validity,status:'Pending',remarks:''});
   const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:p.toString()});
   const x=await r.json(); if(!x.success)throw new Error(x.message||'Could not add vehicle');
   document.getElementById('addVehicleModal').classList.remove('show'); alert('New vehicle added successfully.'); if(typeof loadVehicles==='function')loadVehicles();
 }catch(e){alert('Could not add vehicle.\n\n'+e.message)}
}
window.saveNewVehicle=saveNewVehicle;
