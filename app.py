"""Fichas CD/TTM: servidor local para pacientes, fichas y PDF."""
import os
import re
import threading
import unicodedata
import webbrowser
from datetime import timedelta

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, session, url_for

from acceso import LARGO_MINIMO, Acceso, direcciones, nombre_local
from bases import Almacen, Conflicto, SinBases, documento_vacio
from pdf import SinNavegador, generar_pdf

PUERTO = 8757
BASES = ("sqlite", "duckdb")
LOCALES = ("127.0.0.1", "::1")


def _valida(doc):
    return (isinstance(doc, dict) and isinstance(doc.get("campos"), dict)
            and isinstance(doc.get("trazos"), list) and isinstance(doc.get("textos"), list))


def nombre_archivo(paciente, meta):
    plano = unicodedata.normalize("NFKD", paciente["nombre"]).encode("ascii", "ignore").decode()
    plano = re.sub(r"[^A-Za-z0-9]+", "_", plano).strip("_") or "paciente"
    return f"CD-TTM_{plano}_{meta['fecha_examen'] or meta['id'][:8]}.pdf"


def destino_seguro(ruta):
    return ruta if ruta and ruta.startswith("/") and not ruta.startswith("//") else "/"


def crear_app(almacen=None, acceso=None):
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024
    acceso = acceso or Acceso()
    app.secret_key = acceso.clave_sesion
    hosts_locales = {"127.0.0.1", "localhost", nombre_local().lower()}
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12))
    app.json.ensure_ascii = False
    almacen = almacen or Almacen()
    app.almacen = almacen

    def base_pedida():
        base = request.args.get("base") or None
        if base and base not in almacen.bases:
            abort(400, "Base desconocida o no disponible")
        return base

    def buscar_ficha(ident, base=None):
        par = almacen.ficha(ident, base)
        if not par:
            abort(404)
        paciente = almacen.paciente(par[0]["paciente_id"], base)
        return par[0], par[1], paciente

    def es_local():
        return request.remote_addr in LOCALES

    @app.before_request
    def controlar_acceso():
        if es_local():
            # Evita que una página externa llegue aquí renombrando su dominio.
            if request.host.split(":")[0].lower() not in hosts_locales:
                abort(403)
            return None
        if request.endpoint in ("entrar", "static", "icono_raiz"):
            return None
        if request.endpoint == "acceso_red":
            abort(403)
        if acceso.activo and session.get("sello") == acceso.sello:
            return None
        if request.path.startswith("/api/"):
            return jsonify(error="Debes iniciar sesión de nuevo."), 401
        return redirect(url_for("entrar", siguiente=request.full_path.rstrip("?")))

    @app.context_processor
    def datos_comunes():
        return {"es_local": es_local()}

    @app.route("/entrar", methods=("GET", "POST"))
    def entrar():
        error = ""
        if request.method == "POST":
            ip = request.remote_addr
            if acceso.verificar(ip, request.form.get("contrasena", "")):
                session.permanent = True
                session["sello"] = acceso.sello
                return redirect(destino_seguro(request.form.get("siguiente")))
            error = ("Demasiados intentos. Espera un minuto." if acceso.bloqueado(ip)
                     else "Contraseña incorrecta.")
        return render_template("entrar.html", activo=acceso.activo, error=error,
                               siguiente=request.values.get("siguiente", "/"))

    @app.post("/salir")
    def salir():
        session.clear()
        return redirect(url_for("entrar"))

    @app.route("/red", methods=("GET", "POST"))
    def acceso_red():
        error = ""
        if request.method == "POST":
            if request.form.get("accion") == "desactivar":
                acceso.desactivar()
                return redirect(url_for("acceso_red"))
            nueva = request.form.get("contrasena", "")
            if len(nueva) < LARGO_MINIMO:
                error = f"Usa al menos {LARGO_MINIMO} caracteres."
            elif nueva != request.form.get("repetir"):
                error = "Las contraseñas no coinciden."
            else:
                acceso.definir(nueva)
                return redirect(url_for("acceso_red"))
        puerto = request.environ.get("SERVER_PORT", PUERTO)
        return render_template("red.html", activo=acceso.activo, error=error,
                               direcciones=direcciones(puerto), minimo=LARGO_MINIMO)

    @app.errorhandler(SinBases)
    def sin_bases(e):
        return jsonify(error=str(e)), 503

    @app.errorhandler(Conflicto)
    def conflicto(_):
        return jsonify(error="Esta ficha cambió en otra ventana."), 409

    @app.route("/favicon.ico")
    @app.route("/apple-touch-icon.png")
    @app.route("/apple-touch-icon-precomposed.png")
    def icono_raiz():
        # Los celulares piden estos iconos en la raíz, antes de leer la página.
        nombre = "favicon.png" if request.path == "/favicon.ico" else "apple-touch-icon.png"
        return app.send_static_file(f"iconos/{nombre}")

    @app.route("/")
    def inicio():
        return render_template("inicio.html", pacientes=almacen.pacientes())

    @app.route("/pacientes/<ident>")
    def ver_paciente(ident):
        paciente = almacen.paciente(ident)
        if not paciente:
            abort(404)
        return render_template("paciente.html", p=paciente, fichas=almacen.fichas(ident))

    @app.route("/fichas/<ident>")
    def editar_ficha(ident):
        meta, doc, paciente = buscar_ficha(ident)
        return render_template("ficha.html", meta=meta, doc=doc, p=paciente, imprimir=False)

    @app.route("/fichas/<ident>/imprimir")
    def imprimir_ficha(ident):
        base = base_pedida()
        meta, doc, paciente = buscar_ficha(ident, base)
        return render_template("ficha.html", meta=meta, doc=doc, p=paciente, imprimir=True)

    @app.route("/fichas/<ident>/pdf")
    def pdf_ficha(ident):
        base = base_pedida()
        meta, _, paciente = buscar_ficha(ident, base)
        # El navegador interno entra por este mismo equipo, sin depender de quién pidió el PDF.
        ruta = url_for("imprimir_ficha", ident=ident, base=base)
        url = f"http://127.0.0.1:{request.environ['SERVER_PORT']}{ruta}"
        try:
            contenido = generar_pdf(url)
        except SinNavegador as e:
            return jsonify(error=str(e)), 501
        disposicion = f'inline; filename="{nombre_archivo(paciente, meta)}"'
        return Response(contenido, mimetype="application/pdf",
                        headers={"Content-Disposition": disposicion})

    @app.post("/api/pacientes")
    def crear_paciente():
        datos = request.get_json()
        if not (datos.get("nombre") or "").strip():
            return jsonify(error="El nombre es obligatorio."), 400
        paciente, estados = almacen.crear_paciente(datos)
        return jsonify(paciente=paciente, estados=estados), 201

    @app.put("/api/pacientes/<ident>")
    def actualizar_paciente(ident):
        datos = request.get_json()
        if not (datos.get("nombre") or "").strip():
            return jsonify(error="El nombre es obligatorio."), 400
        paciente, estados = almacen.actualizar_paciente(ident, datos)
        if not paciente:
            abort(404)
        return jsonify(paciente=paciente, estados=estados)

    @app.delete("/api/pacientes/<ident>")
    def eliminar_paciente(ident):
        almacen.eliminar_paciente(ident)
        return jsonify(ok=True)

    @app.post("/api/pacientes/<ident>/fichas")
    def crear_ficha(ident):
        paciente = almacen.paciente(ident)
        if not paciente:
            abort(404)
        datos = request.get_json(silent=True) or {}
        doc = datos.get("documento") or documento_vacio()
        if not _valida(doc):
            return jsonify(error="Documento no válido."), 400
        meta, estados = almacen.crear_ficha(ident, doc)
        return jsonify(ficha=meta, estados=estados), 201

    @app.put("/api/fichas/<ident>")
    def guardar_ficha(ident):
        datos = request.get_json()
        doc = datos.get("documento")
        if not _valida(doc):
            return jsonify(error="Documento no válido."), 400
        meta, estados = almacen.guardar_ficha(ident, doc, datos.get("version"))
        if not meta:
            abort(404)
        return jsonify(version=meta["version"], estados=estados)

    @app.delete("/api/fichas/<ident>")
    def eliminar_ficha(ident):
        almacen.eliminar_ficha(ident)
        return jsonify(ok=True)

    @app.get("/api/salud")
    def salud():
        return jsonify(almacen.salud())

    return app


if __name__ == "__main__":
    if not os.environ.get("FICHA_SIN_NAVEGADOR"):
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PUERTO}/")).start()
    # Escucha en la red, pero fuera de este equipo solo entra quien tenga la contraseña.
    crear_app().run(host="0.0.0.0", port=PUERTO, threaded=True)
