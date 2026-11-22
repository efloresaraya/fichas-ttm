// Versión web: dos bases dentro del navegador de este dispositivo.
//   documentos  IndexedDB con la ficha completa como documento (como DuckDB en el Mac).
//   sqlite      SQLite (sql.js) con una fila por campo, trazo y texto (como SQLite en el Mac),
//               guardado como archivo en otra base IndexedDB.
// Cada una reconstruye la ficha por sí sola; al abrir, la atrasada se pone al día.
const Almacen = (() => {
  const SQL_JS = "vendor/sql.js-1.10.3/"; // incluido en la app para funcionar sin conexión
  let docs = null, sqlArchivo = null, sql = null;
  const errores = {};

  // ---- utilidades IndexedDB ----
  function abrir(nombre, almacenes) {
    return new Promise((ok, mal) => {
      const r = indexedDB.open(nombre, 1);
      r.onupgradeneeded = () => almacenes.forEach((a) => r.result.createObjectStore(a, a === "archivo" ? {} : { keyPath: "id" }));
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
  }
  function pedir(db, almacen, modo, accion) {
    return new Promise((ok, mal) => {
      const tx = db.transaction(almacen, modo);
      const r = accion(tx.objectStore(almacen));
      tx.oncomplete = () => ok(r?.result);
      tx.onerror = () => mal(tx.error);
    });
  }
  const todos = (almacen) => pedir(docs, almacen, "readonly", (s) => s.getAll());
  const uno = (almacen, id) => pedir(docs, almacen, "readonly", (s) => s.get(id));
  const poner = (almacen, valor) => pedir(docs, almacen, "readwrite", (s) => s.put(valor));
  const quitar = (almacen, id) => pedir(docs, almacen, "readwrite", (s) => s.delete(id));

  function cargarScript(src) {
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => mal(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  // ---- base SQLite ----
  const ESQUEMA = `
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS pacientes(id TEXT PRIMARY KEY, nombre TEXT NOT NULL, documento TEXT,
      nacimiento TEXT, telefono TEXT, notas TEXT, version INTEGER NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fichas(id TEXT PRIMARY KEY, paciente_id TEXT NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
      fecha_examen TEXT, examinador TEXT, version INTEGER NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL, huella TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS respuestas(ficha_id TEXT NOT NULL REFERENCES fichas(id) ON DELETE CASCADE,
      campo TEXT NOT NULL, valor TEXT NOT NULL, color TEXT NOT NULL, PRIMARY KEY (ficha_id, campo));
    CREATE TABLE IF NOT EXISTS trazos(ficha_id TEXT NOT NULL REFERENCES fichas(id) ON DELETE CASCADE, orden INTEGER NOT NULL,
      id TEXT NOT NULL, pagina INTEGER NOT NULL, herramienta TEXT NOT NULL, color TEXT NOT NULL, grosor REAL NOT NULL,
      puntos TEXT NOT NULL, PRIMARY KEY (ficha_id, orden));
    CREATE TABLE IF NOT EXISTS textos_libres(ficha_id TEXT NOT NULL REFERENCES fichas(id) ON DELETE CASCADE, orden INTEGER NOT NULL,
      id TEXT NOT NULL, pagina INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL, texto TEXT NOT NULL, color TEXT NOT NULL,
      tam REAL NOT NULL, PRIMARY KEY (ficha_id, orden));`;
  const CAMPOS_PACIENTE = ["id", "nombre", "documento", "nacimiento", "telefono", "notas", "version", "creado", "actualizado"];
  const CAMPOS_FICHA = ["id", "paciente_id", "fecha_examen", "examinador", "version", "creado", "actualizado", "huella"];

  function filas(consulta, args = []) {
    const st = sql.prepare(consulta);
    st.bind(args);
    const salida = [];
    while (st.step()) salida.push(st.getAsObject());
    st.free();
    return salida;
  }
  async function persistirSql() {
    await pedir(sqlArchivo, "archivo", "readwrite", (s) => s.put(sql.export(), "db"));
  }
  function upsert(tabla, campos, objeto) {
    const cambios = campos.slice(1).map((k) => `${k}=excluded.${k}`).join(",");
    sql.run(`INSERT INTO ${tabla}(${campos.join(",")}) VALUES(${campos.map(() => "?").join(",")})
             ON CONFLICT(id) DO UPDATE SET ${cambios}`, campos.map((k) => objeto[k] ?? null));
  }
  // Borrado explícito: no depende de que sql.js tenga activadas las claves foráneas.
  function borrarFichaSql(id) {
    for (const t of ["respuestas", "trazos", "textos_libres"]) sql.run(`DELETE FROM ${t} WHERE ficha_id=?`, [id]);
    sql.run("DELETE FROM fichas WHERE id=?", [id]);
  }
  const SQLITE = {
    async guardarPaciente(p) { upsert("pacientes", CAMPOS_PACIENTE, p); await persistirSql(); },
    async pacientes() { return filas("SELECT * FROM pacientes"); },
    async paciente(id) { return filas("SELECT * FROM pacientes WHERE id=?", [id])[0] || null; },
    async eliminarPaciente(id) {
      for (const f of filas("SELECT id FROM fichas WHERE paciente_id=?", [id])) borrarFichaSql(f.id);
      sql.run("DELETE FROM pacientes WHERE id=?", [id]);
      await persistirSql();
    },
    async guardarFicha(meta, doc) {
      sql.run("BEGIN");
      try {
        upsert("fichas", CAMPOS_FICHA, meta);
        for (const t of ["respuestas", "trazos", "textos_libres"]) sql.run(`DELETE FROM ${t} WHERE ficha_id=?`, [meta.id]);
        for (const [k, v] of Object.entries(doc.campos)) sql.run("INSERT INTO respuestas VALUES(?,?,?,?)", [meta.id, k, v.v, v.c]);
        doc.trazos.forEach((t, i) => sql.run("INSERT INTO trazos VALUES(?,?,?,?,?,?,?,?)",
          [meta.id, i, t.id, t.p, t.h, t.c, t.g, JSON.stringify(t.pts)]));
        doc.textos.forEach((t, i) => sql.run("INSERT INTO textos_libres VALUES(?,?,?,?,?,?,?,?,?)",
          [meta.id, i, t.id, t.p, t.x, t.y, t.t, t.c, t.tam]));
        sql.run("COMMIT");
      } catch (e) {
        sql.run("ROLLBACK");
        throw e;
      }
      await persistirSql();
    },
    async fichas(pacienteId) {
      return pacienteId ? filas("SELECT * FROM fichas WHERE paciente_id=?", [pacienteId]) : filas("SELECT * FROM fichas");
    },
    async ficha(id) {
      const meta = filas("SELECT * FROM fichas WHERE id=?", [id])[0];
      if (!meta) return null;
      const doc = { campos: {}, trazos: [], textos: [] };
      for (const f of filas("SELECT * FROM respuestas WHERE ficha_id=?", [id])) doc.campos[f.campo] = { v: f.valor, c: f.color };
      for (const f of filas("SELECT * FROM trazos WHERE ficha_id=? ORDER BY orden", [id])) {
        doc.trazos.push({ id: f.id, p: f.pagina, h: f.herramienta, c: f.color, g: f.grosor, pts: JSON.parse(f.puntos) });
      }
      for (const f of filas("SELECT * FROM textos_libres WHERE ficha_id=? ORDER BY orden", [id])) {
        doc.textos.push({ id: f.id, p: f.pagina, x: f.x, y: f.y, t: f.texto, c: f.color, tam: f.tam });
      }
      return { meta, doc };
    },
    async eliminarFicha(id) { borrarFichaSql(id); await persistirSql(); },
  };

  // ---- base de documentos ----
  const DOCUMENTOS = {
    guardarPaciente: (p) => poner("pacientes", p),
    pacientes: () => todos("pacientes"),
    paciente: async (id) => (await uno("pacientes", id)) || null,
    async eliminarPaciente(id) {
      for (const f of await DOCUMENTOS.fichas(id)) await quitar("fichas", f.id);
      await quitar("pacientes", id);
    },
    guardarFicha: (meta, doc) => poner("fichas", { ...meta, documento: doc }),
    async fichas(pacienteId) {
      const lista = (await todos("fichas")).map(({ documento, ...meta }) => meta);
      return pacienteId ? lista.filter((f) => f.paciente_id === pacienteId) : lista;
    },
    async ficha(id) {
      const f = await uno("fichas", id);
      if (!f) return null;
      const { documento, ...meta } = f;
      return { meta, doc: documento };
    },
    eliminarFicha: (id) => quitar("fichas", id),
  };

  const BASES = { documentos: DOCUMENTOS, sqlite: SQLITE };

  // ---- utilidades comunes ----
  const ahora = () => new Date().toISOString().slice(0, 19);
  const nuevoId = () => crypto.randomUUID().replaceAll("-", "");
  function canonico(v) {
    if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonico(v[k])).join(",")}}`;
    return JSON.stringify(v);
  }
  async function huella(doc) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonico(doc)));
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function portada(doc) {
    const v = (k) => (doc.campos[k]?.v || "").replaceAll(" ", "");
    const [d, m, a] = [v("fecha.dia"), v("fecha.mes"), v("fecha.anio")];
    return {
      fecha_examen: a.length === 4 && m.length === 2 && d.length === 2 ? `${a}-${m}-${d}` : "",
      examinador: doc.campos.examinador?.v || "",
    };
  }

  async function leer(operacion, base) {
    if (base) return operacion(BASES[base]);
    let ultimo;
    for (const b of Object.values(BASES)) {
      try { return await operacion(b); } catch (e) { ultimo = e; }
    }
    throw ultimo;
  }
  async function escribir(operacion) {
    const estados = {};
    for (const [nombre, b] of Object.entries(BASES)) {
      try {
        await operacion(b);
        estados[nombre] = true;
      } catch (e) {
        errores[nombre] = String(e);
        estados[nombre] = false;
      }
    }
    if (!Object.values(estados).some(Boolean)) throw new Error("Ninguna base pudo guardar.");
    return estados;
  }

  async function reconciliar() {
    let copias = 0;
    for (const [origen, destino] of [[DOCUMENTOS, SQLITE], [SQLITE, DOCUMENTOS]]) {
      const pacientes = new Map((await destino.pacientes()).map((p) => [p.id, p.version]));
      for (const p of await origen.pacientes()) {
        if ((pacientes.get(p.id) || 0) < p.version) { await destino.guardarPaciente(p); copias++; }
      }
      const fichas = new Map((await destino.fichas()).map((f) => [f.id, f.version]));
      for (const f of await origen.fichas()) {
        if ((fichas.get(f.id) || 0) < f.version) {
          const { meta, doc } = await origen.ficha(f.id);
          await destino.guardarFicha(meta, doc);
          copias++;
        }
      }
    }
    return copias;
  }

  async function iniciar() {
    docs = await abrir("fichas-ttm-documentos", ["pacientes", "fichas"]);
    sqlArchivo = await abrir("fichas-ttm-sqlite", ["archivo"]);
    await cargarScript(SQL_JS + "sql-wasm.js");
    const SQL = await initSqlJs({ locateFile: (f) => SQL_JS + f });
    const guardado = await pedir(sqlArchivo, "archivo", "readonly", (s) => s.get("db"));
    sql = guardado ? new SQL.Database(guardado) : new SQL.Database();
    sql.exec(ESQUEMA);
    navigator.storage?.persist?.().catch(() => {});
    await reconciliar();
  }

  return {
    iniciar,
    async pacientes() {
      const lista = await leer((b) => b.pacientes());
      const fichas = await leer((b) => b.fichas());
      for (const p of lista) {
        const propias = fichas.filter((f) => f.paciente_id === p.id);
        p.n_fichas = propias.length;
        p.ultima_ficha = propias.map((f) => f.fecha_examen || "").sort().pop() || "";
      }
      return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
    },
    paciente: (id, base) => leer((b) => b.paciente(id), base),
    async guardarPaciente(id, datos) {
      const momento = ahora();
      const previo = id ? await leer((b) => b.paciente(id)) : null;
      const p = previo ? { ...previo } : { id: nuevoId(), version: 0, creado: momento };
      for (const k of ["nombre", "documento", "nacimiento", "telefono", "notas"]) p[k] = (datos[k] || "").trim();
      p.version += 1;
      p.actualizado = momento;
      await escribir((b) => b.guardarPaciente(p));
      return p;
    },
    async eliminarPaciente(id) { await escribir((b) => b.eliminarPaciente(id)); },
    async fichas(pacienteId) {
      const lista = await leer((b) => b.fichas(pacienteId));
      return lista.sort((a, b) => (b.fecha_examen || "").localeCompare(a.fecha_examen || "") || b.creado.localeCompare(a.creado));
    },
    async crearFicha(pacienteId, doc) {
      const momento = ahora();
      const meta = { id: nuevoId(), paciente_id: pacienteId, ...portada(doc), version: 1,
                     creado: momento, actualizado: momento, huella: await huella(doc) };
      await escribir((b) => b.guardarFicha(meta, doc));
      return meta;
    },
    ficha: (id, base) => leer((b) => b.ficha(id), base),
    async guardarFicha(id, doc, versionBase) {
      const actual = await leer((b) => b.ficha(id));
      if (actual.meta.version !== versionBase) return { conflicto: true };
      const meta = { ...actual.meta, ...portada(doc), version: versionBase + 1, actualizado: ahora(), huella: await huella(doc) };
      return { version: meta.version, estados: await escribir((b) => b.guardarFicha(meta, doc)) };
    },
    async eliminarFicha(id) { await escribir((b) => b.eliminarFicha(id)); },
    async salud() {
      await reconciliar();
      const vista = async (b) => (await b.fichas()).map((f) => `${f.id}:${f.version}:${f.huella}`).sort().join("|");
      const [a, b] = await Promise.all([vista(DOCUMENTOS), vista(SQLITE)]);
      return { coinciden: a === b, fichas: (await DOCUMENTOS.fichas()).length };
    },
    async exportar() {
      const fichas = [];
      for (const f of await DOCUMENTOS.fichas()) fichas.push(await DOCUMENTOS.ficha(f.id));
      return { formato: "fichas-ttm", version: 1, exportado: ahora(), pacientes: await DOCUMENTOS.pacientes(), fichas };
    },
    async importar(respaldo) {
      if (respaldo?.formato !== "fichas-ttm") throw new Error("El archivo no es un respaldo de Fichas TTM.");
      let n = 0;
      for (const p of respaldo.pacientes) {
        const actual = await leer((b) => b.paciente(p.id));
        if (!actual || actual.version < p.version) { await escribir((b) => b.guardarPaciente(p)); n++; }
      }
      for (const { meta, doc } of respaldo.fichas) {
        const actual = await leer((b) => b.ficha(meta.id));
        if (!actual || actual.meta.version < meta.version) { await escribir((b) => b.guardarFicha(meta, doc)); n++; }
      }
      return n;
    },
  };
})();
