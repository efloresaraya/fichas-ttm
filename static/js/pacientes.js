// Pacientes y fichas: alta, búsqueda, edición y eliminación.
async function api(metodo, ruta, cuerpo) {
  const r = await fetch(ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || "No se pudo completar la operación");
  return datos;
}

const buscador = document.getElementById("buscador");
buscador?.addEventListener("input", () => {
  const q = buscador.value.trim().toLocaleLowerCase();
  let visibles = 0;
  document.querySelectorAll("[data-busqueda]").forEach((f) => {
    f.hidden = !f.dataset.busqueda.includes(q);
    if (!f.hidden) visibles++;
  });
  document.getElementById("sin-resultados").hidden = visibles > 0;
});

const dialogo = document.getElementById("dialogo-paciente");
const formulario = document.getElementById("form-paciente");
document.querySelectorAll("[data-abrir-paciente]").forEach((b) => {
  b.addEventListener("click", () => dialogo.showModal());
});
document.querySelector("[data-nuevo-paciente]")?.addEventListener("click", () => {
  formulario.reset();
  delete formulario.dataset.id;
  document.getElementById("titulo-paciente").textContent = "Nuevo paciente";
});
document.querySelectorAll("[data-editar-paciente]").forEach((b) => {
  b.addEventListener("click", () => {
    const p = JSON.parse(b.dataset.editarPaciente);
    for (const k of ["nombre", "documento", "nacimiento", "telefono", "notas"]) formulario.elements[k].value = p[k] || "";
    formulario.dataset.id = p.id;
    document.getElementById("titulo-paciente").textContent = "Editar paciente";
    dialogo.showModal();
  });
});
document.getElementById("cancelar-paciente")?.addEventListener("click", () => dialogo.close());
formulario?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(formulario));
  const ident = formulario.dataset.id;
  try {
    const r = ident ? await api("PUT", `/api/pacientes/${ident}`, datos) : await api("POST", "/api/pacientes", datos);
    location.href = `/pacientes/${r.paciente.id}`;
  } catch (err) {
    document.getElementById("error-paciente").textContent = err.message;
  }
});

function dosDigitos(n) { return String(n).padStart(2, "0"); }

const dialogoFicha = document.getElementById("dialogo-ficha");
const formFicha = document.getElementById("form-ficha");
document.getElementById("nueva-ficha")?.addEventListener("click", () => {
  try { formFicha.examinador.value = localStorage.getItem("examinador") || ""; } catch (_) {}
  dialogoFicha.showModal();
});
document.getElementById("cancelar-ficha")?.addEventListener("click", () => dialogoFicha.close());
formFicha?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const color = "#1d4ed8", hoy = new Date(), examinador = formFicha.examinador.value.trim();
  const campos = {
    paciente: { v: formFicha.dataset.nombre, c: color },
    "fecha.dia": { v: dosDigitos(hoy.getDate()), c: color },
    "fecha.mes": { v: dosDigitos(hoy.getMonth() + 1), c: color },
    "fecha.anio": { v: String(hoy.getFullYear()), c: color },
  };
  if (examinador) {
    campos.examinador = { v: examinador, c: color };
    try { localStorage.setItem("examinador", examinador); } catch (_) {}
  }
  try {
    const r = await api("POST", `/api/pacientes/${formFicha.dataset.id}/fichas`, {
      documento: { campos, trazos: [], textos: [] },
    });
    location.href = `/fichas/${r.ficha.id}`;
  } catch (err) {
    document.getElementById("error-ficha").textContent = err.message;
  }
});

document.querySelectorAll("[data-eliminar]").forEach((b) => {
  b.addEventListener("click", async () => {
    if (!confirm(b.dataset.confirmar)) return;
    try {
      await api("DELETE", b.dataset.eliminar);
      location.href = b.dataset.volver || location.href;
    } catch (err) {
      alert(err.message);
    }
  });
});

const salud = document.getElementById("salud");
if (salud) {
  fetch("/api/salud").then((r) => r.json()).then((d) => {
    const n = d.bases.sqlite.fichas;
    if (d.coinciden) {
      salud.textContent = `SQLite y DuckDB coinciden · ${n} ${n === 1 ? "ficha" : "fichas"}`;
      salud.className = "salud ok";
    } else {
      salud.textContent = "Las bases no coinciden: revisa que ambas estén disponibles";
      salud.className = "salud error";
    }
  });
}
