"""Almacenamiento en dos bases independientes.

SQLite  guarda la ficha desarmada: una fila por campo, trazo y texto libre.
DuckDB  guarda la ficha completa como un documento JSON.

Cada base puede reconstruir la ficha por sí sola. Almacen escribe en ambas,
y al arrancar copia a la base atrasada lo que le falte.
"""
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime

import duckdb

RAIZ = os.path.dirname(os.path.abspath(__file__))
RUTA_SQLITE = os.environ.get("FICHA_SQLITE", os.path.join(RAIZ, "datos", "fichas.sqlite"))
RUTA_DUCKDB = os.environ.get("FICHA_DUCKDB", os.path.join(RAIZ, "datos", "fichas.duckdb"))

CAMPOS_PACIENTE = ("id", "nombre", "documento", "nacimiento", "telefono", "notas",
                   "version", "creado", "actualizado")
CAMPOS_FICHA = ("id", "paciente_id", "fecha_examen", "examinador",
                "version", "creado", "actualizado", "huella")


class Conflicto(Exception):
    """La ficha cambió desde que se abrió (por ejemplo, en otra pestaña)."""


class SinBases(Exception):
    """Ninguna base pudo completar la operación."""


def ahora():
    return datetime.now().isoformat(timespec="seconds")


def documento_vacio():
    return {"campos": {}, "trazos": [], "textos": []}


def _normalizar(valor):
    # SQLite devuelve 10.0 donde el documento decía 10: la huella no debe distinguirlos.
    if isinstance(valor, dict):
        return {k: _normalizar(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_normalizar(v) for v in valor]
    return float(valor) if isinstance(valor, (int, float)) else valor


def huella(doc):
    texto = json.dumps(_normalizar(doc), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


class BaseSQLite:
    nombre = "sqlite"

    def __init__(self, ruta=None):
        self.ruta = ruta or RUTA_SQLITE
        os.makedirs(os.path.dirname(self.ruta), exist_ok=True)
        with self._con() as c:
            c.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS pacientes(
                    id TEXT PRIMARY KEY, nombre TEXT NOT NULL, documento TEXT, nacimiento TEXT,
                    telefono TEXT, notas TEXT, version INTEGER NOT NULL,
                    creado TEXT NOT NULL, actualizado TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS fichas(
                    id TEXT PRIMARY KEY,
                    paciente_id TEXT NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
                    fecha_examen TEXT, examinador TEXT, version INTEGER NOT NULL,
                    creado TEXT NOT NULL, actualizado TEXT NOT NULL, huella TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS fichas_paciente ON fichas(paciente_id);
                CREATE TABLE IF NOT EXISTS respuestas(
                    ficha_id TEXT NOT NULL REFERENCES fichas(id) ON DELETE CASCADE,
                    campo TEXT NOT NULL, valor TEXT NOT NULL, color TEXT NOT NULL,
                    PRIMARY KEY (ficha_id, campo));
                CREATE TABLE IF NOT EXISTS trazos(
                    ficha_id TEXT NOT NULL REFERENCES fichas(id) ON DELETE CASCADE,
                    orden INTEGER NOT NULL, id TEXT NOT NULL, pagina INTEGER NOT NULL,
                    herramienta TEXT NOT NULL, color TEXT NOT NULL, grosor REAL NOT NULL,
                    puntos TEXT NOT NULL, PRIMARY KEY (ficha_id, orden));
                CREATE TABLE IF NOT EXISTS textos_libres(
                    ficha_id TEXT NOT NULL REFERENCES fichas(id) ON DELETE CASCADE,
                    orden INTEGER NOT NULL, id TEXT NOT NULL, pagina INTEGER NOT NULL,
                    x REAL NOT NULL, y REAL NOT NULL, texto TEXT NOT NULL, color TEXT NOT NULL,
                    tam REAL NOT NULL, PRIMARY KEY (ficha_id, orden));
            """)

    @contextmanager
    def _con(self):
        c = sqlite3.connect(self.ruta, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        try:
            with c:
                yield c
        finally:
            c.close()

    def guardar_paciente(self, p):
        columnas = ",".join(CAMPOS_PACIENTE)
        marcas = ",".join("?" * len(CAMPOS_PACIENTE))
        cambios = ",".join(f"{k}=excluded.{k}" for k in CAMPOS_PACIENTE[1:])
        with self._con() as c:
            c.execute(f"INSERT INTO pacientes({columnas}) VALUES({marcas}) "
                      f"ON CONFLICT(id) DO UPDATE SET {cambios}",
                      [p.get(k) for k in CAMPOS_PACIENTE])

    def pacientes(self):
        with self._con() as c:
            return [dict(f) for f in c.execute("SELECT * FROM pacientes")]

    def paciente(self, ident):
        with self._con() as c:
            f = c.execute("SELECT * FROM pacientes WHERE id=?", (ident,)).fetchone()
        return dict(f) if f else None

    def eliminar_paciente(self, ident):
        with self._con() as c:
            c.execute("DELETE FROM pacientes WHERE id=?", (ident,))

    def guardar_ficha(self, meta, doc):
        columnas = ",".join(CAMPOS_FICHA)
        marcas = ",".join("?" * len(CAMPOS_FICHA))
        cambios = ",".join(f"{k}=excluded.{k}" for k in CAMPOS_FICHA[1:])
        with self._con() as c:
            c.execute(f"INSERT INTO fichas({columnas}) VALUES({marcas}) "
                      f"ON CONFLICT(id) DO UPDATE SET {cambios}",
                      [meta.get(k) for k in CAMPOS_FICHA])
            for tabla in ("respuestas", "trazos", "textos_libres"):
                c.execute(f"DELETE FROM {tabla} WHERE ficha_id=?", (meta["id"],))
            c.executemany("INSERT INTO respuestas VALUES(?,?,?,?)",
                          [(meta["id"], k, v["v"], v["c"]) for k, v in doc["campos"].items()])
            c.executemany("INSERT INTO trazos VALUES(?,?,?,?,?,?,?,?)",
                          [(meta["id"], i, t["id"], t["p"], t["h"], t["c"], t["g"], json.dumps(t["pts"]))
                           for i, t in enumerate(doc["trazos"])])
            c.executemany("INSERT INTO textos_libres VALUES(?,?,?,?,?,?,?,?,?)",
                          [(meta["id"], i, t["id"], t["p"], t["x"], t["y"], t["t"], t["c"], t["tam"])
                           for i, t in enumerate(doc["textos"])])

    def fichas(self, paciente_id=None):
        sql, args = "SELECT * FROM fichas", ()
        if paciente_id:
            sql, args = sql + " WHERE paciente_id=?", (paciente_id,)
        with self._con() as c:
            return [dict(f) for f in c.execute(sql, args)]

    def ficha(self, ident):
        with self._con() as c:
            meta = c.execute("SELECT * FROM fichas WHERE id=?", (ident,)).fetchone()
            if not meta:
                return None
            doc = documento_vacio()
            for f in c.execute("SELECT * FROM respuestas WHERE ficha_id=?", (ident,)):
                doc["campos"][f["campo"]] = {"v": f["valor"], "c": f["color"]}
            for f in c.execute("SELECT * FROM trazos WHERE ficha_id=? ORDER BY orden", (ident,)):
                doc["trazos"].append({"id": f["id"], "p": f["pagina"], "h": f["herramienta"],
                                      "c": f["color"], "g": f["grosor"], "pts": json.loads(f["puntos"])})
            for f in c.execute("SELECT * FROM textos_libres WHERE ficha_id=? ORDER BY orden", (ident,)):
                doc["textos"].append({"id": f["id"], "p": f["pagina"], "x": f["x"], "y": f["y"],
                                      "t": f["texto"], "c": f["color"], "tam": f["tam"]})
            return dict(meta), doc

    def eliminar_ficha(self, ident):
        with self._con() as c:
            c.execute("DELETE FROM fichas WHERE id=?", (ident,))


class BaseDuckDB:
    nombre = "duckdb"
    _cerrojo = threading.Lock()

    def __init__(self, ruta=None):
        self.ruta = ruta or RUTA_DUCKDB
        os.makedirs(os.path.dirname(self.ruta), exist_ok=True)
        with self._con() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS pacientes(
                id VARCHAR PRIMARY KEY, version INTEGER NOT NULL, datos VARCHAR NOT NULL)""")
            c.execute("""CREATE TABLE IF NOT EXISTS fichas(
                id VARCHAR PRIMARY KEY, paciente_id VARCHAR NOT NULL, version INTEGER NOT NULL,
                meta VARCHAR NOT NULL, documento VARCHAR NOT NULL)""")

    @contextmanager
    def _con(self):
        # DuckDB bloquea el archivo entre procesos: se abre solo el tiempo de cada operación.
        with self._cerrojo:
            for intento in range(25):
                try:
                    c = duckdb.connect(self.ruta)
                    break
                except duckdb.IOException:
                    if intento == 24:
                        raise
                    time.sleep(0.2)
            try:
                yield c
            finally:
                c.close()

    def guardar_paciente(self, p):
        with self._con() as c:
            c.execute("INSERT OR REPLACE INTO pacientes VALUES(?,?,?)",
                      [p["id"], p["version"], json.dumps(p, ensure_ascii=False)])

    def pacientes(self):
        with self._con() as c:
            return [json.loads(f[0]) for f in c.execute("SELECT datos FROM pacientes").fetchall()]

    def paciente(self, ident):
        with self._con() as c:
            f = c.execute("SELECT datos FROM pacientes WHERE id=?", [ident]).fetchone()
        return json.loads(f[0]) if f else None

    def eliminar_paciente(self, ident):
        with self._con() as c:
            c.execute("DELETE FROM fichas WHERE paciente_id=?", [ident])
            c.execute("DELETE FROM pacientes WHERE id=?", [ident])

    def guardar_ficha(self, meta, doc):
        with self._con() as c:
            c.execute("INSERT OR REPLACE INTO fichas VALUES(?,?,?,?,?)",
                      [meta["id"], meta["paciente_id"], meta["version"],
                       json.dumps(meta, ensure_ascii=False), json.dumps(doc, ensure_ascii=False)])

    def fichas(self, paciente_id=None):
        sql, args = "SELECT meta FROM fichas", []
        if paciente_id:
            sql, args = sql + " WHERE paciente_id=?", [paciente_id]
        with self._con() as c:
            return [json.loads(f[0]) for f in c.execute(sql, args).fetchall()]

    def ficha(self, ident):
        with self._con() as c:
            f = c.execute("SELECT meta, documento FROM fichas WHERE id=?", [ident]).fetchone()
        return (json.loads(f[0]), json.loads(f[1])) if f else None

    def eliminar_ficha(self, ident):
        with self._con() as c:
            c.execute("DELETE FROM fichas WHERE id=?", [ident])


def _datos_portada(doc):
    campos = doc["campos"]
    valor = lambda k: campos.get(k, {}).get("v", "")
    d, m, a = (valor("fecha." + k).replace(" ", "") for k in ("dia", "mes", "anio"))
    fecha = f"{a}-{m}-{d}" if len(a) == 4 and len(m) == 2 and len(d) == 2 else ""
    return fecha, valor("examinador")


class Almacen:
    def __init__(self, ruta_sqlite=None, ruta_duckdb=None):
        self.bases = {}
        self.errores = {}
        for clase, ruta in ((BaseSQLite, ruta_sqlite), (BaseDuckDB, ruta_duckdb)):
            try:
                self.bases[clase.nombre] = clase(ruta)
            except Exception as e:
                self.errores[clase.nombre] = str(e)
        if not self.bases:
            raise SinBases(str(self.errores))
        self.reconciliar()

    # ---- lectura: la primera base disponible responde, salvo que se pida una en concreto
    def _leer(self, operacion, base=None):
        if base:
            return operacion(self.bases[base])
        ultimo = None
        for b in self.bases.values():
            try:
                return operacion(b)
            except Exception as e:
                ultimo = e
        raise SinBases(str(ultimo))

    def _escribir(self, operacion):
        estados = {}
        for nombre, b in self.bases.items():
            try:
                operacion(b)
                estados[nombre] = True
            except Exception as e:
                self.errores[nombre] = str(e)
                estados[nombre] = False
        if not any(estados.values()):
            raise SinBases(str(self.errores))
        return estados

    def pacientes(self, base=None):
        lista = self._leer(lambda b: b.pacientes(), base)
        fichas = self._leer(lambda b: b.fichas(), base)
        for p in lista:
            propias = [f for f in fichas if f["paciente_id"] == p["id"]]
            p["n_fichas"] = len(propias)
            p["ultima_ficha"] = max((f["fecha_examen"] or "" for f in propias), default="")
        return sorted(lista, key=lambda p: p["nombre"].casefold())

    def paciente(self, ident, base=None):
        return self._leer(lambda b: b.paciente(ident), base)

    def crear_paciente(self, datos):
        momento = ahora()
        p = {k: (datos.get(k) or "").strip() for k in CAMPOS_PACIENTE[1:5 + 1]}
        p.update(id=uuid.uuid4().hex, version=1, creado=momento, actualizado=momento)
        return p, self._escribir(lambda b: b.guardar_paciente(p))

    def actualizar_paciente(self, ident, datos):
        p = self.paciente(ident)
        if not p:
            return None, {}
        p.update({k: (datos.get(k) or "").strip() for k in CAMPOS_PACIENTE[1:5 + 1]})
        p.update(version=p["version"] + 1, actualizado=ahora())
        return p, self._escribir(lambda b: b.guardar_paciente(p))

    def fichas(self, paciente_id, base=None):
        lista = self._leer(lambda b: b.fichas(paciente_id), base)
        return sorted(lista, key=lambda f: (f["fecha_examen"] or "", f["creado"]), reverse=True)

    def crear_ficha(self, paciente_id, doc):
        momento = ahora()
        fecha, examinador = _datos_portada(doc)
        meta = dict(id=uuid.uuid4().hex, paciente_id=paciente_id, fecha_examen=fecha,
                    examinador=examinador, version=1, creado=momento, actualizado=momento,
                    huella=huella(doc))
        return meta, self._escribir(lambda b: b.guardar_ficha(meta, doc))

    def ficha(self, ident, base=None):
        return self._leer(lambda b: b.ficha(ident), base)

    def guardar_ficha(self, ident, doc, version_base):
        actual = self.ficha(ident)
        if not actual:
            return None, {}
        meta = actual[0]
        if meta["version"] != version_base:
            raise Conflicto()
        fecha, examinador = _datos_portada(doc)
        meta.update(fecha_examen=fecha, examinador=examinador, version=version_base + 1,
                    actualizado=ahora(), huella=huella(doc))
        return meta, self._escribir(lambda b: b.guardar_ficha(meta, doc))

    def _exigir_ambas(self):
        if len(self.bases) < 2 or self.errores:
            raise SinBases("Para eliminar deben responder ambas bases; una volvería a copiar lo borrado.")

    def eliminar_ficha(self, ident):
        self._exigir_ambas()
        for b in self.bases.values():
            b.eliminar_ficha(ident)

    def eliminar_paciente(self, ident):
        self._exigir_ambas()
        for b in self.bases.values():
            b.eliminar_paciente(ident)

    def reconciliar(self):
        """Lleva a cada base la versión más reciente de lo que tenga la otra."""
        if len(self.bases) < 2:
            return 0
        copias = 0
        a, b = self.bases.values()
        for origen, destino in ((a, b), (b, a)):
            pacientes = {p["id"]: p["version"] for p in destino.pacientes()}
            for p in origen.pacientes():
                if pacientes.get(p["id"], 0) < p["version"]:
                    destino.guardar_paciente(p)
                    copias += 1
            fichas = {f["id"]: f["version"] for f in destino.fichas()}
            for f in origen.fichas():
                if fichas.get(f["id"], 0) < f["version"]:
                    destino.guardar_ficha(*origen.ficha(f["id"]))
                    copias += 1
        self.errores.clear()
        return copias

    def salud(self):
        try:
            self.reconciliar()
        except Exception as e:
            self.errores["reconciliacion"] = str(e)
        resumen = {}
        for nombre, b in self.bases.items():
            try:
                resumen[nombre] = {f["id"]: (f["version"], f["huella"]) for f in b.fichas()}
            except Exception as e:
                self.errores[nombre] = str(e)
        vistas = list(resumen.values())
        coinciden = len(vistas) == 2 and vistas[0] == vistas[1]
        return {
            "bases": {n: {"ok": n in resumen, "fichas": len(resumen.get(n, {}))}
                      for n in ("sqlite", "duckdb")},
            "coinciden": coinciden,
            "errores": self.errores,
        }
