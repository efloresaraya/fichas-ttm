// Versión web: pacientes, fichas y respaldo usando Almacen (dos bases en el navegador).
const parametros = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

function nodo(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const h of hijos) if (h != null) n.append(h);
  return n;
}
function dosDigitos(n) { return String(n).padStart(2, "0"); }

function fallo(e) {
  console.error(e);
  alert("No se pudo completar la operación: " + (e.message || e));
}

// ---- diálogo de paciente (inicio y ficha del paciente) ----
function prepararDialogoPaciente(alGuardar) {
  const dialogo = $("dialogo-paciente"), form = $("form-paciente");
  if (!dialogo) return null;
  $("cancelar-paciente").addEventListener("click", () => dialogo.close());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));
    if (!datos.nombre.trim()) return;
    try {
      const p = await Almacen.guardarPaciente(form.dataset.id || null, datos);
      dialogo.close();
      alGuardar(p);
    } catch (err) {
      $("error-paciente").textContent = err.message;
    }
  });
  return (p) => {
    form.reset();
    if (p) for (const k of ["nombre", "documento", "nacimiento", "telefono", "notas"]) form.elements[k].value = p[k] || "";
    if (p) form.dataset.id = p.id; else delete form.dataset.id;
    $("titulo-paciente").textContent = p ? "Editar paciente" : "Nuevo paciente";
    $("error-paciente").textContent = "";
    dialogo.showModal();
  };
}

async function eliminarPaciente(p, n) {
  if (!confirm(`¿Eliminar a ${p.nombre} y sus ${n} fichas de este dispositivo? No se puede deshacer.`)) return false;
  await Almacen.eliminarPaciente(p.id);
  return true;
}

// ---- inicio ----
async function paginaInicio() {
  const abrirDialogo = prepararDialogoPaciente((p) => { location.href = `paciente.html?id=${p.id}`; });
  $("nuevo-paciente").addEventListener("click", () => abrirDialogo(null));

  async function pintar() {
    const lista = $("lista-pacientes"), pacientes = await Almacen.pacientes();
    lista.replaceChildren();
    $("buscador").hidden = !pacientes.length;
    if (!pacientes.length) {
      lista.append(nodo("p", { className: "vacio", textContent: "Aún no hay pacientes. Crea el primero para abrir su ficha." }));
    }
    for (const p of pacientes) {
      const detalle = `${p.n_fichas} ${p.n_fichas === 1 ? "ficha" : "fichas"}${p.ultima_ficha ? " · última " + p.ultima_ficha : ""}`;
      const fila = nodo("div", { className: "fila" },
        nodo("a", { className: "enlace-fila", href: `paciente.html?id=${p.id}` },
          nodo("span", {}, p.nombre, p.documento ? nodo("span", { className: "detalle", textContent: " · " + p.documento }) : null),
          nodo("span", { className: "detalle", textContent: detalle })),
        nodo("div", { className: "acciones" },
          nodo("button", { className: "boton", textContent: "Editar", onclick: () => abrirDialogo(p) }),
          nodo("button", { className: "boton peligro", textContent: "Eliminar",
                           onclick: async () => { if (await eliminarPaciente(p, p.n_fichas).catch(fallo)) pintar(); } })));
      fila.dataset.busqueda = `${p.nombre} ${p.documento}`.toLocaleLowerCase();
      lista.append(fila);
    }
    lista.append(nodo("p", { className: "vacio", id: "sin-resultados", textContent: "Ningún paciente coincide con la búsqueda.", hidden: true }));
    const salud = await Almacen.salud();
    $("salud").textContent = salud.coinciden
      ? `SQLite y Documentos coinciden · ${salud.fichas} ${salud.fichas === 1 ? "ficha" : "fichas"}`
      : "Las bases no coinciden: recarga la página";
    $("salud").className = "salud " + (salud.coinciden ? "ok" : "error");
  }

  $("buscador").addEventListener("input", () => {
    const q = $("buscador").value.trim().toLocaleLowerCase();
    let visibles = 0;
    document.querySelectorAll("[data-busqueda]").forEach((f) => {
      f.hidden = !f.dataset.busqueda.includes(q);
      if (!f.hidden) visibles++;
    });
    $("sin-resultados").hidden = visibles > 0;
  });

  $("exportar").addEventListener("click", async () => {
    const respaldo = await Almacen.exportar();
    const url = URL.createObjectURL(new Blob([JSON.stringify(respaldo)], { type: "application/json" }));
    nodo("a", { href: url, download: `fichas-ttm-respaldo-${respaldo.exportado.slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $("importar").addEventListener("change", async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    try {
      const n = await Almacen.importar(JSON.parse(await archivo.text()));
      alert(n ? `Se restauraron ${n} registros.` : "El respaldo no tenía nada más reciente que lo guardado aquí.");
      pintar();
    } catch (err) {
      fallo(err);
    }
    e.target.value = "";
  });
  await pintar();
}

// ---- paciente ----
async function paginaPaciente() {
  const id = parametros.get("id");
  let p = await Almacen.paciente(id);
  if (!p) { location.href = "index.html"; return; }
  const abrirDialogo = prepararDialogoPaciente(() => location.reload());
  $("editar-paciente").addEventListener("click", () => abrirDialogo(p));

  document.title = `${p.nombre} · Fichas CD/TTM`;
  $("nombre-paciente").textContent = p.nombre;
  $("nombre-cabecera").textContent = p.nombre;
  const datos = $("datos-paciente");
  for (const [titulo, valor] of [["Documento", p.documento], ["Nacimiento", p.nacimiento], ["Teléfono", p.telefono], ["Notas", p.notas]]) {
    if (titulo === "Notas" && !valor) continue;
    datos.append(nodo("div", {}, nodo("dt", { textContent: titulo }), nodo("dd", { textContent: valor || "—" })));
  }

  const fichas = await Almacen.fichas(id);
  const lista = $("lista-fichas");
  if (!fichas.length) lista.append(nodo("p", { className: "vacio", textContent: "Este paciente aún no tiene fichas." }));
  for (const f of fichas) {
    lista.append(nodo("div", { className: "fila" },
      nodo("a", { href: `ficha.html?id=${f.id}`, textContent: f.fecha_examen || "Ficha sin fecha" }),
      nodo("span", { className: "detalle", textContent: f.examinador }),
      nodo("div", { className: "acciones" },
        nodo("a", { className: "boton", href: `ficha.html?id=${f.id}&pdf=sqlite`, textContent: "PDF desde SQLite" }),
        nodo("a", { className: "boton", href: `ficha.html?id=${f.id}&pdf=documentos`, textContent: "PDF desde Documentos" }),
        nodo("button", { className: "boton peligro", textContent: "Eliminar", onclick: async () => {
          if (!confirm("¿Eliminar esta ficha de este dispositivo? No se puede deshacer.")) return;
          await Almacen.eliminarFicha(f.id).catch(fallo);
          location.reload();
        } }))));
  }

  $("eliminar-paciente").addEventListener("click", async () => {
    if (await eliminarPaciente(p, fichas.length).catch(fallo)) location.href = "index.html";
  });

  const dialogoFicha = $("dialogo-ficha"), formFicha = $("form-ficha");
  $("nueva-ficha").addEventListener("click", () => {
    try { formFicha.examinador.value = localStorage.getItem("examinador") || ""; } catch (_) {}
    dialogoFicha.showModal();
  });
  $("cancelar-ficha").addEventListener("click", () => dialogoFicha.close());
  formFicha.addEventListener("submit", async (e) => {
    e.preventDefault();
    const color = "#1d4ed8", hoy = new Date(), examinador = formFicha.examinador.value.trim();
    const campos = {
      paciente: { v: p.nombre, c: color },
      "fecha.dia": { v: dosDigitos(hoy.getDate()), c: color },
      "fecha.mes": { v: dosDigitos(hoy.getMonth() + 1), c: color },
      "fecha.anio": { v: String(hoy.getFullYear()), c: color },
    };
    if (examinador) {
      campos.examinador = { v: examinador, c: color };
      try { localStorage.setItem("examinador", examinador); } catch (_) {}
    }
    try {
      const meta = await Almacen.crearFicha(p.id, { campos, trazos: [], textos: [] });
      location.href = `ficha.html?id=${meta.id}`;
    } catch (err) {
      $("error-ficha").textContent = err.message;
    }
  });
}

// ---- ficha ----
async function paginaFicha() {
  const id = parametros.get("id");
  const par = await Almacen.ficha(id);
  if (!par) { location.href = "index.html"; return; }
  const p = await Almacen.paciente(par.meta.paciente_id);
  $("titulo-ficha").textContent = p?.nombre || "";
  $("volver").href = `paciente.html?id=${par.meta.paciente_id}`;
  const tituloPdf = (meta) => `CD-TTM ${p?.nombre || ""} ${meta.fecha_examen || ""}`.trim();
  document.title = tituloPdf(par.meta);

  window.FICHA = {
    id, version: par.meta.version, documento: par.doc,
    guardar: (version, doc) => Almacen.guardarFicha(id, doc, version),
    async pdf(base, hojas, docActual) {
      const { meta, doc } = await Almacen.ficha(id, base);
      pintarDocumento(doc, hojas);
      document.title = tituloPdf(meta); // nombre sugerido al guardar como PDF
      window.print();
      pintarDocumento(docActual, hojas);
    },
  };
  await new Promise((ok, mal) => {
    const s = nodo("script", { src: "../static/js/ficha.js", onload: ok, onerror: mal });
    document.body.append(s);
  });
  $("estado").textContent = "Guardado en Documentos y SQLite";
  $("estado").className = "estado ok";
  const base = parametros.get("pdf");
  if (base) {
    $("base-pdf").value = base;
    $("btn-pdf").click();
  }
}

(async () => {
  try {
    await Almacen.iniciar();
    if ($("lista-pacientes")) await paginaInicio();
    else if ($("lista-fichas")) await paginaPaciente();
    else if ($("paginas")) await paginaFicha();
  } catch (e) {
    document.body.prepend(nodo("p", { className: "aviso", textContent: "No se pudo abrir el sistema: " + (e.message || e) }));
    console.error(e);
  }
})();
