// SMOGCERT SOLUTIONS - CURRENT SITE JS
const API_URL="https://script.google.com/macros/s/AKfycbwBTQDO6XKogjzLnJfo-PQSUissGMED1WFVpGKQRaY400OL6N9ntfTQezavI9kpCOuMvA/exec";

let vehicleData=[];
let currentView="upcoming";

const tableBody=document.getElementById("tableBody");
const searchInput=document.getElementById("searchInput");

document.addEventListener("DOMContentLoaded",()=>{
  loadVehicles();
  searchInput?.addEventListener("input",()=>displayVehicles(vehicleData));
  document.getElementById("refreshData")?.addEventListener("click",loadVehicles);
  document.getElementById("upcomingView")?.addEventListener("click",()=>{
    currentView="upcoming"; updateViewButtons(); displayVehicles(vehicleData);
  });
  document.getElementById("vehicleRecordsView")?.addEventListener("click",()=>{
    currentView="all"; updateViewButtons(); displayVehicles(vehicleData);
  });
  document.getElementById("pdfButton")?.addEventListener("click",saveAllDataAsPDF);
});

async function loadVehicles(){
  if(!tableBody)return;
  tableBody.innerHTML='<tr><td colspan="9" style="text-align:center;padding:25px;">Loading vehicles...</td></tr>';
  try{
    const r=await fetch(API_URL+"?action=getVehicles&_="+Date.now(),{cache:"no-store"});
    const result=await r.json();
    if(!result.success)throw new Error(result.message||"Could not load data.");
    vehicleData=Array.isArray(result.vehicles)?result.vehicles:[];
    updateDashboard(vehicleData);
    updateViewButtons();
    displayVehicles(vehicleData);
  }catch(e){
    console.error(e);
    tableBody.innerHTML='<tr><td colspan="9" style="text-align:center;color:red;padding:25px;">Unable to load Google Sheet data.<br>'+escapeHtml(e.message)+'</td></tr>';
  }
}

function getVehicleValue(v,names){
  const keys=Object.keys(v||{});
  for(const wanted of names){
    const key=keys.find(k=>String(k).trim().toLowerCase()===String(wanted).trim().toLowerCase());
    if(key!==undefined&&v[key]!==undefined&&v[key]!==null&&String(v[key]).trim()!=="")return v[key];
  }
  return "";
}

function parseDate(value){
  if(!value)return null;
  if(value instanceof Date&&!isNaN(value.getTime()))return new Date(value.getFullYear(),value.getMonth(),value.getDate());
  const text=String(value).trim();
  let m=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return new Date(+m[1],+m[2]-1,+m[3]);
  m=text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if(m)return new Date(+m[3],+m[2]-1,+m[1]);
  const d=new Date(text);
  return isNaN(d.getTime())?null:new Date(d.getFullYear(),d.getMonth(),d.getDate());
}

function calculateExpiry(timestamp,validity){
  const start=parseDate(timestamp);
  if(!start)return null;
  const text=String(validity||"").trim().toLowerCase();
  const expiry=new Date(start.getFullYear(),start.getMonth(),start.getDate());
  if(/^6\s*months?$/.test(text)){expiry.setMonth(expiry.getMonth()+6);return expiry;}
  if(/^(1\s*year|12\s*months?)$/.test(text)){expiry.setFullYear(expiry.getFullYear()+1);return expiry;}
  const mm=text.match(/^(\d+)\s*months?$/);
  if(mm){expiry.setMonth(expiry.getMonth()+Number(mm[1]));return expiry;}
  const yy=text.match(/^(\d+)\s*years?$/);
  if(yy){expiry.setFullYear(expiry.getFullYear()+Number(yy[1]));return expiry;}
  return null;
}

function getDaysLeft(expiry){
  if(!expiry)return null;
  const n=new Date(),today=new Date(n.getFullYear(),n.getMonth(),n.getDate());
  return Math.round((expiry-today)/86400000);
}

function getExpiryInfo(v){
  const timestamp=getVehicleValue(v,["timestamp","Timestamp"]);
  const validity=getVehicleValue(v,["validUpto","valid upto","valid up to"]);
  const expiry=calculateExpiry(timestamp,validity);
  const days=getDaysLeft(expiry);
  if(days===null)return{expiry,days,label:"Unknown",cls:"expiry-valid"};
  if(days<0)return{expiry,days,label:"Expired",cls:"expiry-expired"};
  if(days<=3)return{expiry,days,label:"Urgent",cls:"expiry-urgent"};
  if(days<=10)return{expiry,days,label:"Due Soon",cls:"expiry-due"};
  return{expiry,days,label:"Valid",cls:"expiry-valid"};
}

function getTimestamp(v){
  const d=parseDate(getVehicleValue(v,["timestamp","Timestamp"]));
  return d?d.getTime():0;
}

function formatDate(d){
  return d?String(d.getDate()).padStart(2,"0")+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+d.getFullYear():"—";
}

function displayVehicles(data){
  if(!tableBody)return;
  const search=(searchInput?.value||"").trim().toLowerCase();

  let filtered=data.filter(v=>{
    const status=String(getVehicleValue(v,["status","Status"])||"Pending").trim().toLowerCase();

    if(currentView==="upcoming"){
      if(status==="closed"||status==="call done"||status==="updated")return false;
      const info=getExpiryInfo(v);
      if(info.days===null||info.days>10)return false;
    }

    if(search){
      const text=[
        getVehicleValue(v,["vehicleNumber","vehicle number","Registration Number"]),
        getVehicleValue(v,["mobileNumber","mobile number","Contact Number"]),
        getVehicleValue(v,["vehicleName","vehicle name"]),
        getVehicleValue(v,["fuelType","fuel type"]),
        status
      ].join(" ").toLowerCase();
      if(!text.includes(search))return false;
    }
    return true;
  });

  if(currentView==="upcoming"){
    // User requested days descending: 10,9,8...0,-1,-2...
    filtered.sort((a,b)=>{
      const ad=getExpiryInfo(a).days,bd=getExpiryInfo(b).days;
      return (bd??-Infinity)-(ad??-Infinity)||getTimestamp(b)-getTimestamp(a);
    });
  }else{
    // Newest Google Sheet record first.
    filtered.sort((a,b)=>getTimestamp(b)-getTimestamp(a));
  }

  tableBody.innerHTML="";
  filtered.forEach(v=>{
    const num=String(getVehicleValue(v,["vehicleNumber","vehicle number","Registration Number"])||"").toUpperCase();
    const mobile=getVehicleValue(v,["mobileNumber","mobile number","Contact Number"]);
    const name=getVehicleValue(v,["vehicleName","vehicle name"])||"—";
    const fuel=getVehicleValue(v,["fuelType","fuel type"])||"—";
    const status=String(getVehicleValue(v,["status","Status"])||"Pending");
    const row=Number(getVehicleValue(v,["rowNumber","row number"]));
    const info=getExpiryInfo(v);

    let daysText="—",daysClass="";
    if(info.days!==null){
      if(info.days<0){const n=Math.abs(info.days);daysText=n+" day"+(n===1?"":"s")+" overdue";daysClass="days-expired";}
      else if(info.days===0){daysText="TODAY";daysClass="days-urgent";}
      else{daysText=info.days+" day"+(info.days===1?"":"s");daysClass=info.days<=3?"days-urgent":info.days<=10?"days-due":"days-valid";}
    }

    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${escapeHtml(num)}</td>
      <td>${escapeHtml(mobile)}</td>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(fuel)}</td>
      <td>${formatDate(info.expiry)}</td>
      <td class="${daysClass}">${daysText}</td>
      <td><span class="record-expiry ${info.cls}">${escapeHtml(info.label)}</span></td>
      <td>${escapeHtml(status)}</td>
      <td class="no-print">
        <div class="action-buttons">
          <button type="button" onclick="markCallDone(${row})">Call Done</button>
          <button type="button" onclick="markCantConnect(${row})">Can't Connect</button>
          <button type="button" onclick="renewVehicle(${row})">Renew</button>
          <button type="button" onclick="closeVehicle(${row})">Close</button>
        </div>
      </td>`;
    tableBody.appendChild(tr);
  });

  if(filtered.length===0){
    tableBody.innerHTML=`<tr><td colspan="9" style="text-align:center;padding:30px;">${currentView==="all"?"No vehicle records found.":"No expired or soon-expiring vehicles."}</td></tr>`;
  }
}

function updateViewButtons(){
  document.getElementById("upcomingView")?.classList.toggle("active",currentView==="upcoming");
  document.getElementById("vehicleRecordsView")?.classList.toggle("active",currentView==="all");
  const pdf=document.getElementById("pdfButton");
  if(pdf)pdf.style.display=currentView==="all"?"inline-block":"none";
}

function updateDashboard(data){
  let valid=0,due=0,done=0,cant=0;
  data.forEach(v=>{
    const status=String(getVehicleValue(v,["status","Status"])||"Pending").trim().toLowerCase();
    if(status==="call done")done++;
    if(status==="can't connect")cant++;
    if(status==="closed")return;
    const days=getExpiryInfo(v).days;
    if(days!==null&&days>10)valid++;
    if(days!==null&&days>=0&&days<=10)due++;
  });
  setText("totalVehicles",valid);
  setText("dueVehicles",due);
  setText("callDone",done);
  setText("cantConnect",cant);
}

async function postAction(action,data){
  const params=new URLSearchParams({action});
  Object.entries(data).forEach(([k,v])=>params.append(k,v??""));
  const r=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:params.toString()});
  const result=await r.json();
  if(!result.success)throw new Error(result.message||"Save failed");
  return result;
}

async function markCallDone(rowNumber){
  const remarks=prompt("Remarks (optional):");
  if(remarks===null)return;
  try{await postAction("callDone",{rowNumber,remarks});alert("Call Done saved.");await loadVehicles();}
  catch(e){alert(e.message);}
}

async function markCantConnect(rowNumber){
  const remarks=prompt("Reason / remarks (optional):");
  if(remarks===null)return;
  try{await postAction("cantConnect",{rowNumber,remarks});alert("Can't Connect saved.");await loadVehicles();}
  catch(e){alert(e.message);}
}

async function closeVehicle(rowNumber){
  if(!confirm("Close this vehicle reminder? It will remain in Vehicle Records."))return;
  const remarks=prompt("Closing remarks (optional):");
  if(remarks===null)return;
  try{await postAction("close",{rowNumber,remarks});alert("Vehicle closed. It remains in Vehicle Records.");await loadVehicles();}
  catch(e){alert(e.message);}
}

async function renewVehicle(rowNumber){
  const choice=prompt("Enter new PUCC validity:\n\n1 = 6 month\n2 = 1 year");
  if(choice===null)return;
  let validity;
  if(choice.trim()==="1")validity="6 month";
  else if(choice.trim()==="2")validity="1 year";
  else{alert("Please enter 1 or 2.");return;}
  const remarks=prompt("Renewal remarks (optional):");
  if(remarks===null)return;
  try{
    await postAction("update",{rowNumber,newValidity:validity,remarks});
    alert("Renewal saved as a new vehicle record.");
    await loadVehicles();
  }catch(e){alert(e.message);}
}

function saveAllDataAsPDF(){
  const oldView=currentView,oldSearch=searchInput?.value||"";
  currentView="all";
  if(searchInput)searchInput.value="";
  updateViewButtons();
  displayVehicles(vehicleData);
  setTimeout(()=>{
    window.print();
    setTimeout(()=>{
      currentView=oldView;
      if(searchInput)searchInput.value=oldSearch;
      updateViewButtons();
      displayVehicles(vehicleData);
    },500);
  },300);
}

function setText(id,value){const e=document.getElementById(id);if(e)e.textContent=value;}
function escapeHtml(v){
  return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

window.markCallDone=markCallDone;
window.markCantConnect=markCantConnect;
window.closeVehicle=closeVehicle;
window.renewVehicle=renewVehicle;
