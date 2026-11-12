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
function deviceId() {
  try {
    let d = localStorage.getItem("ktu_device");
    if (!d) {
      d = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
      localStorage.setItem("ktu_device", d);
    }
    return d;
  } catch (e) { return (window._memDev = window._memDev || (Date.now().toString(36) + Math.random().toString(36).slice(2))); }
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
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

const LOCATION_ERRORS = {
  0: "This browser cannot share location. Try Chrome or Safari.",
  1: "Location is blocked. Allow location for this site in your browser settings, then try again.",
  2: "Your phone could not find your location. Turn on GPS and try again.",
  3: "Finding your location took too long. Move near a window and try again."
};

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("go").disabled = true;
  say("Getting your location…");
  try {
    const pos = await getPosition();
    say("Checking in…");
    const code = $("code").value.trim().toUpperCase();
    const idx = $("idx").value.trim();
    const { data, error } = await sb.rpc("check_in", {
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
    if (error) throw new Error("Could not reach the server. Check your internet and try again.");
    if (!data.ok) { if (/screen code/i.test(data.error)) pass = null; say(data.error, "bad"); }
    else {
      try { localStorage.setItem("ktu_idx", idx); localStorage.setItem("ktu_prog", $("prog").value); localStorage.setItem("ktu_name", $("name").value.trim()); localStorage.setItem("ktu_lvl", $("lvl").value); } catch (e2) {}
      showDone(data);
    }
  } catch (err) {
    say(err && err.message ? err.message : (LOCATION_ERRORS[err && err.code] || "Something went wrong. Try again."), "bad");
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
  const endPhase = d.phase === "end";
  $("doneTitle").textContent = endPhase ? "End-of-class check recorded, " + titleCase(d.name.split(" ")[0]) + "." : d.in_range ? "You're checked in, " + titleCase(d.name.split(" ")[0]) + "." : "Recorded, please see your lecturer";
  $("doneSub").textContent = endPhase ? "Thank you. Your end-of-class check is saved." : d.late && d.in_range ? "You were marked late for this class." : d.in_range ? "Your attendance is recorded for this class." : "You appear to be " + d.distance_m + " m from the class. Tell your lecturer if you are in the room.";
  const L = $("doneList"); L.textContent = "";
  for (const [k, v] of [["Name", d.name], ["Status", endPhase ? "End check" : d.late ? "Late" : "On time"], ["Index", d.index], ["Level", d.level], ["Class", d.course], ["Time", t]]) {
    const a = document.createElement("dt"), b = document.createElement("dd"); a.textContent = k; b.textContent = v; b.className = "v-" + k.toLowerCase(); L.append(a, b);
  }
}
