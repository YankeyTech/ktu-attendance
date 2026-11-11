const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

function say(text, kind) { $("msg").textContent = text; $("msg").className = "msg " + (kind || ""); }

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
  } catch (e) { return ""; }
}

// Class code from the link (?s=CODE).
const fromLink = new URLSearchParams(location.search).get("s");
if (fromLink) $("code").value = fromLink.toUpperCase().slice(0, 8);

async function lookup() {
  const code = $("code").value.trim().toUpperCase();
  $("course").textContent = "";
  if (code.length < 4) return;
  const { data, error } = await sb.rpc("get_session", { p_code: code });
  if (error || !data || !data.length) { $("course").textContent = "Class code not found."; return; }
  $("course").textContent = data[0].course + (data[0].is_open ? "" : " (check-in closed)");
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
      p_ua: (navigator.userAgent || "").slice(0, 300)
    });
    if (error) throw new Error("Could not reach the server. Check your internet and try again.");
    if (!data.ok) { say(data.error, "bad"); }
    else {
      try { localStorage.setItem("ktu_idx", idx); localStorage.setItem("ktu_prog", $("prog").value); } catch (e2) {}
      if (data.in_range) say("You are checked in for " + data.course + ".", "ok");
      else say("Recorded, but you appear to be " + data.distance_m + " m from the class. Tell your lecturer if you are in the room.", "warn");
    }
  } catch (err) {
    say(err && err.message ? err.message : (LOCATION_ERRORS[err && err.code] || "Something went wrong. Try again."), "bad");
  } finally {
    $("go").disabled = false;
  }
});
