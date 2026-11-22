"""Reconstruye PDF desde una de las bases, sin depender del servidor en marcha.

    python reconstruir.py --base sqlite --salida pdf_sqlite
    python reconstruir.py --base duckdb --salida pdf_duckdb --ficha <id>
"""
import argparse
import os
import threading

from werkzeug.serving import make_server

from app import crear_app, nombre_archivo
from pdf import generar_pdf


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--base", choices=("sqlite", "duckdb"), required=True)
    args.add_argument("--salida", default="pdf_reconstruidos")
    args.add_argument("--ficha", help="id de una ficha; si se omite, se reconstruyen todas")
    op = args.parse_args()

    app = crear_app()
    base = app.almacen.bases[op.base]
    metas = [m for m in base.fichas() if not op.ficha or m["id"] == op.ficha]
    os.makedirs(op.salida, exist_ok=True)

    servidor = make_server("127.0.0.1", 0, app, threaded=True)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    try:
        for meta in metas:
            contenido = generar_pdf(
                f"http://127.0.0.1:{servidor.server_port}/fichas/{meta['id']}/imprimir?base={op.base}")
            ruta = os.path.join(op.salida, nombre_archivo(base.paciente(meta["paciente_id"]), meta))
            ruta = ruta[:-4] + f"_{meta['id'][:6]}.pdf"
            with open(ruta, "wb") as f:
                f.write(contenido)
            print(ruta)
    finally:
        servidor.shutdown()
    print(f"{len(metas)} PDF desde {op.base}.")


if __name__ == "__main__":
    main()
