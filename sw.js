// KTU check-in service worker: keeps the app shell for fast start and an offline screen.
// Pages and scripts are fetched from the network first, so updates always show; the cache is only the fallback.
const CACHE = "ktu-shell-v5";
const SHELL = ["./", "index.html", "teacher.html", "admin.html", "offline.html", "install-check.html", "style.css", "extra.css", "shared.js", "student.js", "teacher.js", "admin.js", "admin2.js", "chat.js", "programmes.js", "config.js", "icons/app-192.png", "icons/admin-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return; // never touch Supabase or other sites
  e.respondWith(fetch(r).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || (r.mode === "navigate" ? caches.match("offline.html") : Response.error()))));
});
