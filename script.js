
// ======================================================
// SMOGCERT SIMPLE LOGIN
// Change these two values if you want a different login.
// ======================================================
const SMOGCERT_USERNAME = "admin";
const SMOGCERT_PASSWORD = "ASDF@321";
const SMOGCERT_LOGIN_KEY = "smogcert_logged_in";

function smogcertShowApp(){
  document.body.classList.remove("smogcert-locked");
  const login=document.getElementById("smogcertLogin");
  const logout=document.getElementById("smogcertLogout");
  if(login)login.style.display="none";
  if(logout)logout.style.display="block";
}
function smogcertShowLogin(){
  document.body.classList.add("smogcert-locked");
  const login=document.getElementById("smogcertLogin");
  const logout=document.getElementById("smogcertLogout");
  if(login)login.style.display="flex";
  if(logout)logout.style.display="none";
}
function smogcertLogin(){
  const u=(document.getElementById("loginUsername")?.value||"").trim();
  const p=document.getElementById("loginPassword")?.value||"";
  const err=document.getElementById("loginError");
  if(u===SMOGCERT_USERNAME && p===SMOGCERT_PASSWORD){
    sessionStorage.setItem(SMOGCERT_LOGIN_KEY,"1");
    if(err)err.textContent="";
    smogcertShowApp();
  }else{
    if(err)err.textContent="Invalid username or password";
    const pass=document.getElementById("loginPassword");
    if(pass){pass.value="";pass.focus();}
  }
}
document.addEventListener("DOMContentLoaded",()=>{
  document.getElementById("loginButton")?.addEventListener("click",smogcertLogin);
  document.getElementById("loginPassword")?.addEventListener("keydown",e=>{
    if(e.key==="Enter")smogcertLogin();
  });
  document.getElementById("smogcertLogout")?.addEventListener("click",()=>{
    sessionStorage.removeItem(SMOGCERT_LOGIN_KEY);
    location.reload();
  });
  if(sessionStorage.getItem(SMOGCERT_LOGIN_KEY)==="1")smogcertShowApp();
  else smogcertShowLogin();
});

const API_URL="https://script.google.com/macros/s/AKfycbwBTQDO6XKogjzLnJfo-PQSUissGMED1WFVpGKQRaY400OL6N9ntfTQezavI9kpCOuMvA/exec";
let vehicleData=[],currentView="upcoming";
const $=id=>document.getElementById(id);

document.addEventListener("DOMContentLoaded",()=>{
  $("searchInput")?.addEventListener("input",()=>displayVehicles(vehicleData));
  $("refreshData")?.addEventListener("click",loadVehicles);
  $("upcomingView")?.addEventListener("click",()=>{currentView="upcoming";updateViewButtons();displayVehicles(vehicleData)});
  $("vehicleRecordsView")?.addEventListener("click",()=>{currentView="all";updateViewButtons();displayVehicles(vehicleData)});
  $("pdfButton")?.addEventListener("click",saveAllDataAsPDF);
  loadVehicles();
});

async function loadVehicles(){
  const body=$("tableBody"); if(!body)return;
  body.innerHTML='<tr><td colspan="9" style="text-align:center;padding:30px">Loading vehicles...</td></tr>';
  try{
    const r=await fetch(API_URL+"?action=getVehicles&_="+Date.now(),{cache:"no-store"});
    const x=await r.json();
    if(!x.success)throw new Error(x.message||"Google Sheet error");
    vehicleData=Array.isArray(x.vehicles)?x.vehicles:[];
    updateDashboard();updateViewButtons();displayVehicles(vehicleData);
  }catch(e){
    console.error(e);
    body.innerHTML='<tr><td colspan="9" style="text-align:center;color:#b91c1c;padding:30px">Unable to load Google Sheet data.<br>'+esc(e.message)+'</td></tr>';
  }
}
function val(v,names){
  const keys=Object.keys(v||{});
  for(const n of names){
    const k=keys.find(a=>a.toLowerCase().replace(/[\s_-]/g,"")===n.toLowerCase().replace(/[\s_-]/g,""));
    if(k!==undefined&&v[k]!==null&&v[k]!==undefined&&String(v[k]).trim()!=="")return v[k];
  }
  return "";
}
function anyField(v,tests){
  const k=Object.keys(v||{}).find(a=>tests.some(t=>a.toLowerCase().includes(t)));
  return k? v[k]:"";
}
function date(v){
  if(!v)return null;
  const s=String(v).trim();
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return new Date(+m[1],+m[2]-1,+m[3]);
  m=s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if(m)return new Date(+m[3],+m[2]-1,+m[1]);
  const d=new Date(s); return isNaN(d)?null:new Date(d.getFullYear(),d.getMonth(),d.getDate());
}
function expiry(v){
  // First prefer an actual expiry date if the sheet/API already has one.
  const explicit=anyField(v,["expiry","expire","validuntil","validupto"]);
  const ed=date(explicit);
  if(ed)return ed;

  // Otherwise the sheet's "6 month" / "1 year" value is a validity period.
  const validity=val(v,["validUpto","validity","puccValidity","puccPeriod","validPeriod"])||anyField(v,["validity","period"]);
  const start=date(val(v,["timestamp","date","createdAt","created"]));
  if(!start)return null;
  const s=String(validity).trim().toLowerCase(),d=new Date(start);
  if(/^6\s*months?$/.test(s)){d.setMonth(d.getMonth()+6);return d}
  if(/^1\s*year$/.test(s)||/^12\s*months?$/.test(s)){d.setFullYear(d.getFullYear()+1);return d}
  const mm=s.match(/^(\d+)\s*months?$/);if(mm){d.setMonth(d.getMonth()+Number(mm[1]));return d}
  const yy=s.match(/^(\d+)\s*years?$/);if(yy){d.setFullYear(d.getFullYear()+ +yy[1]);return d}
  return null;
}
function days(d){if(!d)return null;const n=new Date(),t=new Date(n.getFullYear(),n.getMonth(),n.getDate());return Math.round((d-t)/86400000)}
function info(v){
  const e=expiry(v),n=days(e);
  if(n===null)return{expiry:e,days:null,label:"Unknown",cls:"expiry-valid"};
  if(n<0)return{expiry:e,days:n,label:"Expired",cls:"expiry-expired"};
  if(n<=3)return{expiry:e,days:n,label:"Urgent",cls:"expiry-urgent"};
  if(n<=10)return{expiry:e,days:n,label:"Due Soon",cls:"expiry-due"};
  return{expiry:e,days:n,label:"Valid",cls:"expiry-valid"};
}
function rowDate(v){const d=date(val(v,["timestamp","date","createdAt"]));return d?d.getTime():0}
function fmt(d){return d?String(d.getDate()).padStart(2,"0")+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+d.getFullYear():"—"}

function displayVehicles(data){
  const q=($("searchInput")?.value||"").trim().toLowerCase();
  let a=data.filter(v=>{
    const st=String(val(v,["status"])||"Pending").trim().toLowerCase();
    const i=info(v);
    if(currentView==="upcoming"){
      if(["closed","call done","updated"].includes(st))return false;
      if(i.days===null||i.days>10)return false;
    }
    if(q){
      const text=[val(v,["vehicleNumber","registrationNumber","registration"]),val(v,["mobileNumber","phone"]),val(v,["vehicleName"]),val(v,["fuelType"]),st].join(" ").toLowerCase();
      if(!text.includes(q))return false;
    }
    return true;
  });

  if(currentView==="upcoming")a.sort((x,y)=>(info(y).days??-Infinity)-(info(x).days??-Infinity)||rowDate(y)-rowDate(x));
  else a.sort((x,y)=>rowDate(y)-rowDate(x));

  const body=$("tableBody");body.innerHTML="";
  a.forEach(v=>{
    const i=info(v),n=i.days;
    let daysText="—",dc="";
    if(n!==null){if(n<0){const z=Math.abs(n);daysText=z+" day"+(z===1?"":"s")+" overdue";dc="days-expired"}else if(n===0){daysText="TODAY";dc="days-urgent"}else{daysText=n+" day"+(n===1?"":"s");dc=n<=3?"days-urgent":n<=10?"days-due":"days-valid"}}
    const row=Number(val(v,["rowNumber","row"]));
    const st=String(val(v,["status"])||"Pending");
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${esc(String(val(v,["vehicleNumber","registrationNumber","registration"])||"").toUpperCase())}</td>
    <td>${esc(val(v,["mobileNumber","phone"]))}</td><td>${esc(val(v,["vehicleName"])||"—")}</td>
    <td>${esc(val(v,["fuelType"])||"—")}</td><td>${fmt(i.expiry)}</td><td class="${dc}">${daysText}</td>
    <td><span class="record-expiry ${i.cls}">${i.label}</span></td><td>${esc(st)}</td>
    <td class="no-print"><div class="action-buttons">
    <button class="callDone" onclick="callDone(${row})">Call Done</button>
    <button class="cantConnect" onclick="cantConnect(${row})">Can't Connect</button>
    <button class="renew" onclick="renewVehicle(${row})">Renew</button>
    <button class="closeCase" onclick="closeVehicle(${row})">Close</button></div></td>`;
    body.appendChild(tr);
  });
  if(!a.length)body.innerHTML='<tr><td colspan="9" style="text-align:center;padding:30px">No records found.</td></tr>';
}
function updateViewButtons(){
  $("upcomingView")?.classList.toggle("active",currentView==="upcoming");
  $("vehicleRecordsView")?.classList.toggle("active",currentView==="all");
  if($("pdfButton"))$("pdfButton").style.display=currentView==="all"?"inline-block":"none";
}
function updateDashboard(){
  let valid=0,due=0,urgent=0,expired=0,done=0,cant=0;
  vehicleData.forEach(v=>{
    const st=String(val(v,["status"])||"Pending").toLowerCase(),n=info(v).days;
    if(st==="call done")done++;if(st==="can't connect")cant++;if(st==="closed")return;
    if(n<0)expired++;else if(n<=3)urgent++;else if(n<=10)due++;else if(n!==null)valid++;
  });
  $("totalVehicles").textContent=valid;$("dueVehicles").textContent=due;$("urgentVehicles").textContent=urgent;$("expiredVehicles").textContent=expired;$("callDone").textContent=done;$("cantConnect").textContent=cant;
}
async function post(action,data){
  const p=new URLSearchParams({action});Object.entries(data).forEach(([k,v])=>p.append(k,v??""));
  const r=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:p.toString()});
  const x=await r.json();if(!x.success)throw new Error(x.message||"Save failed");return x;
}
async function callDone(rowNumber){const remarks=prompt("Remarks (optional):");if(remarks===null)return;try{await post("callDone",{rowNumber,remarks});alert("Call Done saved.");loadVehicles()}catch(e){alert(e.message)}}
async function cantConnect(rowNumber){const remarks=prompt("Reason / remarks (optional):");if(remarks===null)return;try{await post("cantConnect",{rowNumber,remarks});alert("Can't Connect saved.");loadVehicles()}catch(e){alert(e.message)}}
async function closeVehicle(rowNumber){if(!confirm("Close this reminder? It will remain in Vehicle Records."))return;const remarks=prompt("Closing remarks (optional):");if(remarks===null)return;try{await post("close",{rowNumber,remarks});alert("Vehicle closed.");loadVehicles()}catch(e){alert(e.message)}}
async function renewVehicle(rowNumber){const c=prompt("Enter new PUCC validity:\n1 = 6 month\n2 = 1 year");if(c===null)return;const nv=c.trim()==="1"?"6 month":c.trim()==="2"?"1 year":"";if(!nv){alert("Enter 1 or 2.");return}const remarks=prompt("Renewal remarks (optional):");if(remarks===null)return;try{await post("update",{rowNumber,newValidity:nv,remarks});alert("Renewal saved as a new record.");loadVehicles()}catch(e){alert(e.message)}}
function saveAllDataAsPDF(){const old=currentView,qs=$("searchInput").value;currentView="all";$("searchInput").value="";updateViewButtons();displayVehicles(vehicleData);setTimeout(()=>{window.print();setTimeout(()=>{currentView=old;$("searchInput").value=qs;updateViewButtons();displayVehicles(vehicleData)},500)},300)}
function esc(x){return String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
window.callDone=callDone;window.cantConnect=cantConnect;window.closeVehicle=closeVehicle;window.renewVehicle=renewVehicle;
