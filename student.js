const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

function say(text, kind) { $("msg").textContent = text; $("msg").className = "msg " + (kind || ""); }

// Fill the programme dropdown.
for (const g of PROGRAMMES) {
  const og = document.createElement("optgroup");
  og.label = g.group;
  for (const name of g.items) {
    const o = document.createElement("option");
    o.value = name; o.textContent = name;
    og.appendChild(o);
  }
  $("prog").appendChild(og);
}

// Remember the student's own details on this phone (convenience only).
try {
  $("idx").value = localStorage.getItem("ktu_idx") || "";
  $("prog").value = localStorage.getItem("ktu_prog") || "";
} catch (e) {}

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
    const { data, error } = await sb.rpc("check_in", {
      p_code: $("code").value.trim().toUpperCase(),
      p_index: $("idx").value.trim(),
      p_programme: $("prog").value,
      p_lat: pos.coords.latitude,
      p_lng: pos.coords.longitude,
      p_accuracy: pos.coords.accuracy
    });
    if (error) throw new Error("Could not reach the server. Check your internet and try again.");
    if (!data.ok) { say(data.error, "bad"); }
    else {
      try { localStorage.setItem("ktu_idx", $("idx").value.trim()); localStorage.setItem("ktu_prog", $("prog").value); } catch (e2) {}
      if (data.in_range) say("You are checked in for " + data.course + ".", "ok");
      else say("Recorded, but you appear to be " + data.distance_m + " m from the class. Tell your lecturer if you are in the room.", "warn");
    }
  } catch (err) {
    say(err && err.message ? err.message : (LOCATION_ERRORS[err && err.code] || "Something went wrong. Try again."), "bad");
  } finally {
    $("go").disabled = false;
  }
});
