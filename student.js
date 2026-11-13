const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const titleCase = (t) => t.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
function say(text, kind) {
  $("msg").textContent = text; $("msg").className = "msg " + (kind || "");
  if (kind === "bad") { const f = $("f"); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); }
}

// Fill a programme dropdown. Accepts groups like {group, items:[...]} and also plain strings,
// so an older or differently shaped programmes.js cannot break the page.
function fillProgrammes(sel) {
  const list = (typeof PROGRAMMES !== "undefined" && Array.isArray(PROGRAMMES)) ? PROGRAMMES : [];
  const addOpt = (parent, name) => {
    const o = document.createElement("option");
    o.value = name; o.textContent = name;
    parent.appendChild(o);
  };
  for (const g of list) {
    if (typeof g === "string") { addOpt(sel, g); continue; }
    const items = (g && (g.items || g.programmes || g.options || g.list)) || [];
    if (!Array.isArray(items) || !items.length) { console.warn("Skipped programme group:", g); continue; }
    const og = document.createElement("optgroup");
    og.label = g.group || g.label || g.name || "Programmes";
    for (const name of items) addOpt(og, name);
    sel.appendChild(og);
  }
  if (!list.length) console.warn("PROGRAMMES is missing or empty. Check programmes.js is loaded before this script.");
}
fillProgrammes($("prog"));

// Remember the student's own details on this phone (convenience only).
try {
  $("idx").value = localStorage.getItem("ktu_idx") || "";
  $("prog").value = localStorage.getItem("ktu_prog") || "";
  $("name").value = localStorage.getItem("ktu_name") || "";
  $("lvl").value = localStorage.getItem("ktu_lvl") || "";
} catch (e) {}

// Hidden phone ID, created once and kept on this phone.
const STORAGE_HELP = "This browser is not saving data, so check-in is blocked. Turn off Private Browsing, allow cookies for this site, and open the page in Safari or Chrome.";
function readCookie() { const m = document.cookie.match(/(?:^|; )ktu_device=([^;]+)/); return m ? decodeURIComponent(m[1]) : ""; }
function writeCookie(v) {
  try { document.cookie = "ktu_device=" + encodeURIComponent(v) + "; max-age=31536000; path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); } catch (e) {}
}
// The phone's saved ID is kept in two places (browser storage and a cookie).
// Returns "" when the browser will not save anything, so check-in can be refused.
function deviceId() {
  const ok = (v) => /^[\w-]{8,64}$/.test(v || "");
  let ls = "", ck = "";
  try { ls = localStorage.getItem("ktu_device") || ""; } catch (e) {}
  try { ck = readCookie(); } catch (e) {}
  let d = ok(ls) ? ls : ok(ck) ? ck : "";
  if (!d) d = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  try { if (ls !== d) localStorage.setItem("ktu_device", d); } catch (e) {}
  writeCookie(d);
  let savedLs = false; try { savedLs = localStorage.getItem("ktu_device") === d; } catch (e) {}
  let savedCk = false; try { savedCk = readCookie() === d; } catch (e) {}
  return savedLs || savedCk ? d : "";
}

// Class code from the link (?s=CODE).
const fromLink = new URLSearchParams(location.search).get("s");
const tokLink = new URLSearchParams(location.search).get("t");
if (tokLink) $("tok").value = tokLink.replace(/\D/g, "").slice(0, 6);
if (fromLink) $("code").value = fromLink.toUpperCase().slice(0, 8);

// Screen code: checked as soon as it is known, then the phone gets a 10-minute pass.
let pass = null;
async function claim() {
  const tok = $("tok").value.replace(/\D/g, ""), code = $("code").value.trim().toUpperCase();
  pass = null; $("tokMsg").textContent = "";
  if (tok.length !== 6 || code.length < 4) return;
  if (!deviceId()) { $("tokMsg").className = "msg bad"; $("tokMsg").textContent = STORAGE_HELP; return; }
  $("tokMsg").className = "msg"; $("tokMsg").textContent = "Checking the screen code...";
  const { data, error } = await sb.rpc("get_pass", { p_code: code, p_token: tok, p_device: deviceId() });
  if (error || !data) { $("tokMsg").className = "msg bad"; $("tokMsg").textContent = "Could not check the screen code. Try again."; return; }
  if (!data.ok) { $("tokMsg").className = "msg bad"; $("tokMsg").textContent = data.error; return; }
  pass = data.pass; $("tokMsg").className = "msg ok"; $("tokMsg").textContent = "Screen code accepted. Finish your details within 10 minutes.";
}
$("tok").addEventListener("input", claim);

// Combined classes: only the programmes and levels the lecturer allowed can be chosen.
const progAllHTML = $("prog").innerHTML;
let groupsNow = null, restricted = false;
function syncLevels() {
  let al = null;
  if (groupsNow) { const ls = groupsNow.filter((g) => g.programme === $("prog").value); al = ls.some((g) => g.level === "All levels") ? null : ls.map((g) => g.level); }
  for (const o of $("lvl").options) if (o.value) o.disabled = !!al && !al.includes(o.value);
  const cur = $("lvl").selectedOptions[0]; if (cur && cur.disabled) $("lvl").value = "";
}
function setGroups(gs) {
  const prog = $("prog"), keep = prog.value;
  groupsNow = gs;
  if (gs) {
    const names = Array.from(new Set(gs.map((g) => g.programme)));
    prog.textContent = "";
    const first = document.createElement("option"); first.value = ""; first.textContent = "Select your programme"; prog.appendChild(first);
    for (const n of names) { const o = document.createElement("option"); o.value = n; o.textContent = n; prog.appendChild(o); }
    prog.value = names.includes(keep) ? keep : (names.length === 1 ? names[0] : "");
    restricted = true;
  } else if (restricted) { prog.innerHTML = progAllHTML; prog.value = keep; restricted = false; }
  syncLevels();
}
$("prog").addEventListener("change", syncLevels);

async function lookup() {
  const code = $("code").value.trim().toUpperCase();
  $("course").textContent = ""; $("courseCard").hidden = true; if (groupsNow || restricted) setGroups(null); $("tokWrap").hidden = true; $("tok").required = false;
  if (code.length < 4) return;
  const { data, error } = await sb.rpc("get_session", { p_code: code });
  if (error || !data || !data.length) { $("course").textContent = "Class code not found."; return; }
  const s = data[0];
  $("cname").textContent = s.course;
  $("cmeta").textContent = [[s.academic_year, s.semester].filter(Boolean).join(", "), s.combined ? "Combined class. Open to: " + (s.class_groups || []).map((g) => g.programme + " (" + g.level + ")").join("; ") : s.programme, s.combined ? "" : s.level, s.lecturer ? "Lecturer: " + s.lecturer : ""].filter(Boolean).join("  |  ") + (s.two_point && s.end_open ? "  |  End-of-class check" : "") + (s.is_open ? "" : "  |  Check-in closed");
  $("tokWrap").hidden = !s.rotating; $("tok").required = !!s.rotating;
  if (s.rotating && !pass) claim();
  $("courseCard").className = "coursecard" + (s.is_open ? "" : " closed"); $("courseCard").hidden = false;
  const fill = (sel, v) => { if (v && !sel.value && Array.from(sel.options).some((o) => o.value === v)) sel.value = v; };
  if (s.combined) setGroups(s.class_groups || []); else { fill($("prog"), s.programme); fill($("lvl"), s.level); }
}
$("code").addEventListener("input", lookup);
lookup();

function getPosition() {
  if (!navigator.geolocation) return Promise.reject({ code: 0 });
  const ask = (opts) => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
  // Precise GPS first. If it is slow or fails (not denied), try the quicker network location once.
  return ask({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }).catch((e) => {
    if (e && e.code === 1) throw e;
    return ask({ enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
  });
}

// Help for "location denied", with steps that match the phone.
const UA = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|MicroMessenger|Telegram/i.test(UA);
function inAppNote() {
  const p = document.createElement("p"); p.style.margin = "8px 0 0";
  p.textContent = "You opened this page inside another app, which often blocks location. Open the link in " + (isIOS ? "Safari" : "Chrome") + " instead, using the browser icon or menu in that app.";
  return p;
}
function showLocHelp() {
  const box = $("locHelp"); box.textContent = "";
  const h = document.createElement("b"); h.textContent = "Location is turned off for this page. Fix it like this:"; box.appendChild(h);
  const steps = isIOS ? [
    "Open Settings, then Privacy & Security, then Location Services, and make sure it is On.",
    "Scroll down to Safari Websites and choose While Using the App (or Ask Next Time). Turn on Precise Location.",
    "Back in Safari, tap the aA icon in the address bar, then Website Settings, then Location, and choose Allow. Reload the page and press Check in again."
  ] : [
    "Turn on Location (GPS) in your phone's quick settings.",
    "Tap the lock or settings icon next to the web address, then Permissions, then Location, and choose Allow.",
    "Reload the page and press Check in again."
  ];
  const ol = document.createElement("ol");
  for (const t of steps) { const li = document.createElement("li"); li.textContent = t; ol.appendChild(li); }
  box.appendChild(ol);
  if (inApp) box.appendChild(inAppNote());
  box.hidden = false;
}
function hideLocHelp() {
  const box = $("locHelp"); box.textContent = "";
  if (inApp) { box.appendChild(inAppNote()); box.hidden = false; } else box.hidden = true;
}
hideLocHelp();
try {
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then((p) => {
      const upd = () => { if (p.state === "denied") showLocHelp(); else hideLocHelp(); };
      upd(); p.onchange = upd;
    }).catch(() => {});
  }
} catch (e) {}

const LOCATION_ERRORS = {
  0: "This browser cannot share location. Try Chrome or Safari.",
  1: "Location is blocked. Allow location for this site in your browser settings, then try again.",
  2: "Your phone could not find your location. Turn on GPS and try again.",
  3: "Finding your location took too long. Move near a window and try again."
};

function setStep(n) {
  const ol = $("steps"); ol.hidden = n < 0;
  Array.from(ol.children).forEach((li, i) => { li.className = i < n ? "done" : i === n ? "now" : ""; });
}
// Network hiccups: try again up to 3 times before giving up.
async function rpcRetry(name, args) {
  for (let i = 0; i < 3; i++) {
    const r = await sb.rpc(name, args);
    if (!r.error) return { data: r.data, retried: i > 0 };
    if (i < 2) { say("Weak connection, trying again (" + (i + 2) + " of 3)...", "warn"); await new Promise((res) => setTimeout(res, 1500 * (i + 1))); }
  }
  throw new Error("Could not reach the server. Check your internet and try again.");
}
let lastDone = null, lastCtx = null;
$("again").addEventListener("click", () => $("go").click());

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!deviceId()) { say(STORAGE_HELP, "bad"); return; }
  $("go").disabled = true; $("again").hidden = true;
  setStep(0); say("Getting your location…");
  try {
    const pos = await getPosition();
    setStep(1); say("Checking in…");
    const code = $("code").value.trim().toUpperCase();
    const idx = $("idx").value.trim();
    const { data, retried } = await rpcRetry("check_in", {
      p_code: code,
      p_index: idx,
      p_programme: $("prog").value,
      p_lat: pos.coords.latitude,
      p_lng: pos.coords.longitude,
      p_accuracy: pos.coords.accuracy,
      p_device: deviceId() || null,
      p_ua: (navigator.userAgent || "").slice(0, 300),
      p_name: titleCase($("name").value.trim()),
      p_level: $("lvl").value,
      p_token: pass || $("tok").value.replace(/\D/g, "") || null
    });
    if (!data.ok && retried && /already checked in/i.test(data.error)) { setStep(-1); say("Your first attempt already went through, so you are checked in. Ask your lecturer if you are unsure.", "ok"); return; }
    if (!data.ok) { if (/screen code/i.test(data.error)) pass = null; setStep(-1); say(data.error, "bad"); $("again").hidden = false; }
    else {
      try { localStorage.setItem("ktu_idx", idx); localStorage.setItem("ktu_prog", $("prog").value); localStorage.setItem("ktu_name", $("name").value.trim()); localStorage.setItem("ktu_lvl", $("lvl").value); } catch (e2) {}
      lastCtx = { code, idx }; setStep(2); showDone(data);
    }
  } catch (err) {
    say(err && err.message ? err.message : (LOCATION_ERRORS[err && err.code] || "Something went wrong. Try again."), "bad");
    if (err && err.code === 1) showLocHelp();
    setStep(-1); $("again").hidden = false;
  } finally {
    $("go").disabled = false;
  }
});

function showDone(d) {
  const t = new Date(d.at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("f").hidden = true; $("done").hidden = false;
  $("tick").className = "tick" + (d.in_range ? "" : " warn");
  $("tick").textContent = d.in_range ? "\u2713" : "!";
  if (d.in_range) confetti();
  lastDone = d;
  const endPhase = d.phase === "end";
  $("retryBox").hidden = d.in_range || endPhase;
  if (!$("retryBox").hidden) {
    const m = d.distance_m != null ? d.distance_m : "?", r = d.radius_m != null ? " (allowed: " + d.radius_m + " m)" : "", a = d.accuracy_m ? " Your GPS accuracy was about " + d.accuracy_m + " m." : "";
    $("whyRed").textContent = "You were about " + m + " m from the class" + r + "." + a + " Move closer to where your lecturer is, ideally near a window, then try again. This only works while check-in is open.";
  }
  $("doneTitle").textContent = endPhase ? "End-of-class check recorded, " + titleCase(d.name.split(" ")[0]) + "." : d.in_range ? "You're checked in, " + titleCase(d.name.split(" ")[0]) + "." : "Recorded, please see your lecturer";
  $("doneSub").textContent = endPhase ? "Thank you. Your end-of-class check is saved." : d.late && d.in_range ? "You were marked late for this class." : d.in_range ? "Your attendance is recorded for this class." : "You appear to be " + d.distance_m + " m from the class. Tell your lecturer if you are in the room.";
  const L = $("doneList"); L.textContent = "";
  for (const [k, v] of [["Name", d.name], ["Status", endPhase ? "End check" : d.late ? "Late" : "On time"], ["Index", d.index], ["Level", d.level], ["Class", d.course], ["Time", t]]) {
    const a = document.createElement("dt"), b = document.createElement("dd"); a.textContent = k; b.textContent = v; b.className = "v-" + k.toLowerCase(); L.append(a, b);
  }
}


$("retryLoc").addEventListener("click", async () => {
  const msg = (t, k) => { $("retryMsg").textContent = t; $("retryMsg").className = "msg " + (k || ""); };
  $("retryLoc").disabled = true; msg("Getting your location...");
  try {
    const pos = await getPosition();
    const { data } = await rpcRetry("retry_location", { p_code: lastCtx.code, p_index: lastCtx.idx, p_device: deviceId() || null, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy: pos.coords.accuracy });
    if (!data.ok) return msg(data.error, "bad");
    if (data.in_range) { showDone(Object.assign({}, lastDone, { in_range: true, distance_m: data.distance_m })); return; }
    lastDone = Object.assign({}, lastDone, { distance_m: data.distance_m, radius_m: data.radius_m, accuracy_m: data.accuracy_m });
    msg("Still about " + data.distance_m + " m away (allowed " + data.radius_m + " m). Move closer and try again.", "warn");
    $("whyRed").textContent = "You were about " + data.distance_m + " m from the class (allowed: " + data.radius_m + " m). Move closer to where your lecturer is, then try again.";
  } catch (err) {
    msg(err && err.message ? err.message : (LOCATION_ERRORS[err && err.code] || "Could not get your location."), "bad");
    if (err && err.code === 1) showLocHelp();
  } finally { $("retryLoc").disabled = false; }
});
