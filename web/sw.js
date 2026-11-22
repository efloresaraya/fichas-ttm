// Guarda la app en el dispositivo para que abra sin conexión.
// VERSION y ARCHIVOS los escribe herramientas/actualizar_sin_conexion.py.
const VERSION = "10469b47b309";
const ARCHIVOS = [
  "./",
  "../static/css/estilo.css",
  "../static/iconos/apple-touch-icon.png",
  "../static/iconos/favicon.png",
  "../static/iconos/icono-192.png",
  "../static/iconos/icono-512.png",
  "../static/iconos/icono-maskable-512.png",
  "../static/js/ficha.js",
  "../static/js/pacientes.js",
  "../static/js/plantilla.js",
  "../static/js/render.js",
  "almacen.js",
  "ficha.html",
  "index.html",
  "manifest.json",
  "paciente.html",
  "vendor/sql.js-1.10.3/sql-wasm.js",
  "vendor/sql.js-1.10.3/sql-wasm.wasm",
  "web.js",
];
const CACHE = `fichas-ttm-${VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith("fichas-ttm-") && n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

// Primero lo guardado; si no está, la red. Las páginas se buscan sin "?id=…".
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.open(CACHE)
      .then((c) => c.match(e.request, { ignoreSearch: e.request.mode === "navigate" }))
      .then((guardado) => guardado || fetch(e.request)),
  );
});
