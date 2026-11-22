// Editor: marcar, pintar y escribir sobre la ficha, con guardado automático.
const COLORES = ["#1d4ed8", "#dc2626", "#16a34a", "#ea580c", "#7c3aed", "#111827", "#eab308"];
const GROSORES = {
  lapiz: [0.8, 1.5, 3],
  resaltador: [7, 11, 16],
  texto: [7, 9, 12],
};
const NOMBRES_BASES = { sqlite: "SQLite", duckdb: "DuckDB", documentos: "Documentos" };
const DEMORA_GUARDADO = 400;
const ESPERA_MAXIMA_GUARDADO = 2000; // guarda aunque se siga escribiendo sin pausa

const FICHA = window.FICHA;
let doc = FICHA.documento;
let version = FICHA.version;
const herr = { actual: "marcar", color: COLORES[0], nivel: 1 };
const paginas = [];
let hojas = [];
const entradas = new Map(); // id de campo -> elementos HTML

// ---- deshacer ----
let ultimo = JSON.stringify(doc);
const deshacer = [], rehacer = [];

function confirmar() {
  const actual = JSON.stringify(doc);
  if (actual === ultimo) return;
  deshacer.push(ultimo);
  rehacer.length = 0;
  ultimo = actual;
  refrescar();
  programarGuardado();
}

function viajar(desde, hacia) {
  if (!desde.length) return;
  hacia.push(ultimo);
  ultimo = desde.pop();
  doc = JSON.parse(ultimo);
  refrescar();
  sincronizarEntradas();
  programarGuardado();
}

function refrescar() {
  pintarDocumento(doc, hojas);
  document.getElementById("btn-deshacer").disabled = !deshacer.length;
  document.getElementById("btn-rehacer").disabled = !rehacer.length;
}

// ---- guardado ----
let temporizador = null, enCurso = null, sucio = false, sucioDesde = 0;
const estado = document.getElementById("estado");

function avisar(texto, clase) {
  estado.textContent = texto;
  estado.className = "estado " + (clase || "");
}

function programarGuardado() {
  if (!sucio) sucioDesde = Date.now();
  sucio = true;
  avisar("Guardando…");
  clearTimeout(temporizador);
  const restante = ESPERA_MAXIMA_GUARDADO - (Date.now() - sucioDesde);
  temporizador = setTimeout(guardar, Math.max(0, Math.min(DEMORA_GUARDADO, restante)));
}

async function guardar() {
  clearTimeout(temporizador);
  if (enCurso) await enCurso;
  if (!sucio) return true;
  sucio = false;
  enCurso = enviar().finally(() => { enCurso = null; });
  return enCurso;
}

// La versión con servidor guarda por la API; la versión web trae su propio FICHA.guardar.
async function guardarEnServidor(versionBase, documento) {
  const r = await fetch(`/api/fichas/${FICHA.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: versionBase, documento }),
  });
  const datos = await r.json();
  if (r.status === 409) return { conflicto: true };
  if (!r.ok) throw new Error(datos.error);
  return datos;
}

async function enviar() {
  try {
    const datos = await (FICHA.guardar || guardarEnServidor)(version, doc);
    if (datos.conflicto) {
      avisar("Esta ficha se modificó en otra ventana. Recarga la página.", "error");
      return false;
    }
    version = datos.version;
    const fallos = Object.entries(datos.estados).filter(([, ok]) => !ok).map(([n]) => n);
    const nombres = Object.keys(datos.estados).map((n) => NOMBRES_BASES[n] || n);
    if (fallos.length) avisar(`Guardado solo en una base; falló ${NOMBRES_BASES[fallos[0]] || fallos[0]}`, "error");
    else avisar(`Guardado en ${nombres.join(" y ")}`, "ok");
    return true;
  } catch (e) {
    sucio = true;
    avisar("No se pudo guardar. Reintentando…", "error");
    temporizador = setTimeout(guardar, 4000);
    return false;
  }
}

window.addEventListener("beforeunload", (e) => {
  if (sucio || enCurso) e.preventDefault();
});

// Último intento al cerrar o dejar la página, también en celulares.
window.addEventListener("pagehide", () => {
  if (!sucio || FICHA.guardar) return;
  fetch(`/api/fichas/${FICHA.id}`, {
    method: "PUT",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, documento: doc }),
  }).catch(() => {});
});

// ---- marcar ----
function asignar(id, valor) {
  if (valor === "" || valor === null) delete doc.campos[id];
  else doc.campos[id] = { v: valor, c: doc.campos[id]?.c || herr.color };
}

function marcarOpcion(id, valor) {
  if (doc.campos[id]?.v === valor) delete doc.campos[id];
  else doc.campos[id] = { v: valor, c: herr.color };
  confirmar();
}

function zonaMarca(capa, id, valor, x, y, w, h, titulo) {
  const r = el("rect", { x, y, width: w, height: h, rx: 2, class: "zona", "data-id": id, "data-valor": valor }, capa);
  el("title", {}, r).textContent = titulo;
}

function crearZonas(indice, svg) {
  const capa = el("g", { class: "capa-zonas" }, svg);
  capa.addEventListener("click", (e) => {
    const z = e.target.closest(".zona");
    if (z && herr.actual === "marcar") marcarOpcion(z.dataset.id, z.dataset.valor);
  });
  for (const c of PLANTILLA.campos) {
    if (c.p !== indice) continue;
    if (c.t === "ns") {
      const titulo = c.id.replaceAll(".", " · ").replaceAll("_", " ");
      zonaMarca(capa, c.id, "N", c.n[0] - 6.6, c.n[1] - 5.9, 13.2, 11.8, titulo + " = No");
      zonaMarca(capa, c.id, "S", c.s[0] - 6.6, c.s[1] - 5.9, 13.2, 11.8, titulo + " = Sí");
    } else if (c.t === "op") {
      const w = Math.max(c.fin - c.c[0] + c.r + 3, 12);
      zonaMarca(capa, c.id, c.valor, c.c[0] - c.r - 1.5, c.c[1] - 5.5, w, 11, c.id.replaceAll("_", " "));
    }
  }
}

// ---- escribir en cajas y líneas ----
function porcentaje(valor, total) { return (valor / total) * 100 + "%"; }

function colocar(n, x0, y0, x1, y1) {
  n.style.left = porcentaje(x0, PLANTILLA.ancho);
  n.style.top = porcentaje(y0, PLANTILLA.alto);
  n.style.width = porcentaje(x1 - x0, PLANTILLA.ancho);
  n.style.height = porcentaje(y1 - y0, PLANTILLA.alto);
}

function tamCq(tam) { return `calc(${tam} / ${PLANTILLA.ancho} * 100cqw)`; }

function crearEntradas(indice, hoja) {
  const cadena = PLANTILLA.campos.filter((c) => c.t === "cajas" && c.id.startsWith("fecha."));
  for (const c of PLANTILLA.campos) {
    if (c.p !== indice) continue;
    if (c.t === "cajas") {
      const cajas = [];
      for (let i = 0; i < c.xs.length - 1; i++) {
        const n = document.createElement("input");
        n.className = "entrada caja";
        n.inputMode = "numeric";
        n.autocomplete = "off";
        n.setAttribute("aria-label", `${c.id} dígito ${i + 1}`);
        n.style.fontSize = tamCq(TAM_CAJA);
        colocar(n, c.xs[i] + 0.6, c.y0 + 0.6, c.xs[i + 1] - 0.6, c.y1 - 0.6);
        hoja.appendChild(n);
        cajas.push(n);
      }
      entradas.set(c.id, cajas);
      cajas.forEach((n, i) => {
        n.addEventListener("input", () => {
          // Admite varios dígitos a la vez (pegar o escritura rápida) repartidos por las cajas.
          const digitos = n.value.replace(/\D/g, "");
          let ultima = i;
          n.value = digitos[0] || "";
          for (let j = 1; j < digitos.length && i + j < cajas.length; j++) {
            cajas[i + j].value = digitos[j];
            ultima = i + j;
          }
          asignar(c.id, cajas.map((x) => x.value || " ").join("").trimEnd());
          programarGuardado();
          pintarDocumento(doc, hojas);
          if (n.value) siguienteCaja(c, cajas, ultima)?.focus();
        });
        n.addEventListener("keydown", (e) => {
          if (e.key === "Backspace" && !n.value && i > 0) cajas[i - 1].focus();
        });
        n.addEventListener("focus", () => n.select());
        n.addEventListener("change", confirmar);
      });
    } else if (c.t === "linea") {
      const n = document.createElement("input");
      n.className = "entrada linea";
      n.autocomplete = "off";
      n.setAttribute("aria-label", c.id);
      n.placeholder = "Nombre Apellido";
      colocar(n, c.x0, c.y0, c.x1, c.y1 + 1);
      hoja.appendChild(n);
      entradas.set(c.id, [n]);
      n.addEventListener("input", () => {
        asignar(c.id, n.value);
        ajustarLinea(n, c);
        programarGuardado();
        pintarDocumento(doc, hojas);
      });
      n.addEventListener("change", confirmar);
    } else if (c.t === "area") {
      const n = document.createElement("textarea");
      n.className = "entrada area";
      n.setAttribute("aria-label", "Comentarios del examinador");
      n.placeholder = "Escribe aquí los comentarios";
      colocar(n, c.x0, c.y0, c.x1, c.y1);
      hoja.appendChild(n);
      entradas.set(c.id, [n]);
      n.addEventListener("input", () => {
        if (!ajustarArea(n.value, c)) {
          n.value = doc.campos[c.id]?.v || "";
          avisar("El recuadro de comentarios está lleno", "error");
          return;
        }
        asignar(c.id, n.value);
        ajustarTextarea(n, c);
        programarGuardado();
        pintarDocumento(doc, hojas);
      });
      n.addEventListener("change", confirmar);
    }
  }
  function siguienteCaja(c, cajas, i) {
    if (i < cajas.length - 1) return cajas[i + 1];
    const pos = cadena.indexOf(c);
    return pos >= 0 && pos < cadena.length - 1 ? entradas.get(cadena[pos + 1].id)?.[0] : null;
  }
}

function ajustarLinea(n, c) { n.style.fontSize = tamCq(tamLinea(n.value, c)); }

function ajustarTextarea(n, c) {
  const ajuste = ajustarArea(n.value, c);
  n.style.fontSize = tamCq(ajuste ? ajuste.tam : AREA_MIN);
}

function sincronizarEntradas() {
  for (const c of PLANTILLA.campos) {
    const nodos = entradas.get(c.id);
    if (!nodos) continue;
    const marca = doc.campos[c.id];
    const valor = marca?.v || "";
    nodos.forEach((n, i) => {
      n.value = c.t === "cajas" ? (valor[i] || "").trim() : valor;
      n.style.color = marca?.c || herr.color;
    });
    if (c.t === "linea") ajustarLinea(nodos[0], c);
    if (c.t === "area") ajustarTextarea(nodos[0], c);
  }
}

// ---- pintar, texto libre y borrador ----
function punto(svg, e) {
  const r = svg.getBoundingClientRect();
  return [
    +((e.clientX - r.left) * PLANTILLA.ancho / r.width).toFixed(1),
    +((e.clientY - r.top) * PLANTILLA.alto / r.height).toFixed(1),
  ];
}

function nuevoId() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); }

function conectarLienzo(indice, hoja, svg, capas) {
  let actual = null, ruta = null;

  svg.addEventListener("pointerdown", (e) => {
    if (herr.actual === "lapiz" || herr.actual === "resaltador") {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      actual = {
        id: nuevoId(), p: indice, h: herr.actual, c: herr.color,
        g: GROSORES[herr.actual][herr.nivel], pts: [punto(svg, e)],
      };
      ruta = el("path", atributosTrazo(actual), capas.trazos);
    } else if (herr.actual === "borrador") {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      actual = "borrando";
      borrarEn(indice, punto(svg, e));
    }
  });

  svg.addEventListener("pointermove", (e) => {
    if (actual === "borrando") return borrarEn(indice, punto(svg, e));
    if (!actual) return;
    for (const m of e.getCoalescedEvents?.() || [e]) {
      const p = punto(svg, m), u = actual.pts[actual.pts.length - 1];
      if (Math.hypot(p[0] - u[0], p[1] - u[1]) >= 0.5) actual.pts.push(p);
    }
    ruta.setAttribute("d", trazoRuta(actual.pts));
  });

  const terminar = () => {
    if (actual === "borrando") confirmar();
    else if (actual) { doc.trazos.push(actual); confirmar(); }
    actual = ruta = null;
  };
  svg.addEventListener("pointerup", terminar);
  svg.addEventListener("pointercancel", terminar);

  svg.addEventListener("click", (e) => {
    if (herr.actual !== "texto") return;
    const existente = e.target.closest?.("[data-texto]");
    if (existente) {
      const t = doc.textos.find((x) => x.id === existente.dataset.texto);
      abrirTexto(hoja, indice, t.x, t.y, t);
    } else {
      const [x, y] = punto(svg, e);
      abrirTexto(hoja, indice, x, y, null);
    }
  });
}

function borrarEn(indice, [x, y]) {
  const cerca = (t) => t.p === indice && t.pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < t.g / 2 + 3);
  const textoCerca = (t) => t.p === indice && x >= t.x - 2 && x <= t.x + anchoTexto(t.t, t.tam) + 2
    && y <= t.y + 3 && y >= t.y - t.tam - 1;
  const antes = doc.trazos.length + doc.textos.length;
  doc.trazos = doc.trazos.filter((t) => !cerca(t));
  doc.textos = doc.textos.filter((t) => !textoCerca(t));
  if (doc.trazos.length + doc.textos.length !== antes) pintarDocumento(doc, hojas);
}

function abrirTexto(hoja, indice, x, y, existente) {
  const tam = existente?.tam || GROSORES.texto[herr.nivel];
  const color = existente?.c || herr.color;
  const n = document.createElement("input");
  n.className = "texto-libre";
  n.value = existente?.t || "";
  n.style.left = porcentaje(x, PLANTILLA.ancho);
  n.style.top = porcentaje(y - tam, PLANTILLA.alto);
  n.style.fontSize = tamCq(tam);
  n.style.color = color;
  n.setAttribute("aria-label", "Texto libre");
  hoja.appendChild(n);
  n.focus();
  let cerrado = false;
  const cerrar = (guardarlo) => {
    if (cerrado) return;
    cerrado = true;
    const texto = n.value.trim();
    n.remove();
    if (!guardarlo) return;
    if (existente) {
      if (texto) existente.t = texto;
      else doc.textos = doc.textos.filter((t) => t !== existente);
    } else if (texto) {
      doc.textos.push({ id: nuevoId(), p: indice, x, y, t: texto, c: color, tam });
    }
    confirmar();
  };
  n.addEventListener("keydown", (e) => {
    if (e.key === "Enter") cerrar(true);
    if (e.key === "Escape") cerrar(false);
  });
  n.addEventListener("blur", () => cerrar(true));
}

// ---- barra de herramientas ----
function elegirHerramienta(nombre) {
  herr.actual = nombre;
  document.body.dataset.herramienta = nombre;
  document.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === nombre));
}

function elegirColor(color) {
  herr.color = color;
  document.querySelectorAll(".muestra").forEach((b) => b.setAttribute("aria-pressed", b.dataset.color === color));
  document.getElementById("color-propio").value = color;
}

function prepararBarra() {
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.addEventListener("click", () => elegirHerramienta(b.dataset.tool));
  });
  const paleta = document.getElementById("paleta");
  for (const color of COLORES) {
    const b = document.createElement("button");
    b.className = "muestra";
    b.dataset.color = color;
    b.style.background = color;
    b.setAttribute("aria-label", "Color " + color);
    b.addEventListener("click", () => elegirColor(color));
    paleta.appendChild(b);
  }
  document.getElementById("color-propio").addEventListener("input", (e) => elegirColor(e.target.value));
  document.querySelectorAll("[data-nivel]").forEach((b) => {
    b.addEventListener("click", () => {
      herr.nivel = +b.dataset.nivel;
      document.querySelectorAll("[data-nivel]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    });
  });
  document.getElementById("btn-deshacer").addEventListener("click", () => viajar(deshacer, rehacer));
  document.getElementById("btn-rehacer").addEventListener("click", () => viajar(rehacer, deshacer));
  document.getElementById("btn-pdf").addEventListener("click", FICHA.pdf ? imprimirDesdeBase : descargarPdf);

  let zoom = 1;
  const aplicarZoom = (d) => {
    zoom = Math.min(2.2, Math.max(0.6, zoom + d));
    document.documentElement.style.setProperty("--zoom", zoom);
  };
  document.getElementById("btn-mas").addEventListener("click", () => aplicarZoom(0.2));
  document.getElementById("btn-menos").addEventListener("click", () => aplicarZoom(-0.2));

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      if (e.target.matches("input, textarea")) return;
      e.preventDefault();
      if (e.shiftKey) viajar(rehacer, deshacer); else viajar(deshacer, rehacer);
    }
  });
  elegirColor(COLORES[0]);
  elegirHerramienta("marcar");
}

async function descargarPdf() {
  const boton = document.getElementById("btn-pdf");
  const base = document.getElementById("base-pdf").value;
  const ventana = window.open("about:blank");
  boton.disabled = true;
  boton.textContent = "Generando…";
  try {
    document.activeElement?.blur?.();
    confirmar();
    await guardar();
    const r = await fetch(`/fichas/${FICHA.id}/pdf?base=${base}`);
    if (r.status === 501) {
      ventana?.close();
      window.print();
      return;
    }
    if (!r.ok) throw new Error();
    const url = URL.createObjectURL(await r.blob());
    if (ventana) ventana.location = url; else location.href = url;
  } catch (e) {
    ventana?.close();
    avisar("No se pudo generar el PDF", "error");
  } finally {
    boton.disabled = false;
    boton.textContent = "Generar PDF";
  }
}

// Versión web: guarda, repinta con la ficha leída de la base elegida y abre la impresión.
async function imprimirDesdeBase() {
  document.activeElement?.blur?.();
  confirmar();
  await guardar();
  await FICHA.pdf(document.getElementById("base-pdf").value, hojas, doc);
}

function iniciar() {
  const contenedor = document.getElementById("paginas");
  PLANTILLA.paginas.forEach((_, i) => {
    const { hoja, svg, capas } = crearHoja(i, contenedor);
    paginas.push({ hoja, svg });
    hojas.push(capas);
    crearZonas(i, svg);
    crearEntradas(i, hoja);
    conectarLienzo(i, hoja, svg, capas);
  });
  prepararBarra();
  refrescar();
  sincronizarEntradas();
}

iniciar();
