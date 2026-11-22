"""Actualiza la lista de archivos que la versión web guarda para funcionar sin conexión.

Uso:  python herramientas/actualizar_sin_conexion.py
Ejecutarlo después de cambiar cualquier archivo de web/ o static/: la nueva
versión hace que los iPad y celulares descarguen la app actualizada.
"""
import hashlib
import os
import re

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SW = os.path.join(RAIZ, "web", "sw.js")
CARPETAS = ("web", "static")
EXCLUIR = ("web/sw.js", "static/manifest.json")


def archivos():
    lista = []
    for carpeta in CARPETAS:
        for base, _, nombres in os.walk(os.path.join(RAIZ, carpeta)):
            for n in nombres:
                ruta = os.path.relpath(os.path.join(base, n), RAIZ).replace(os.sep, "/")
                if not n.startswith(".") and ruta not in EXCLUIR:
                    lista.append(ruta)
    return sorted(lista)


def main():
    lista = archivos()
    h = hashlib.sha256()
    for ruta in lista:
        h.update(ruta.encode())
        with open(os.path.join(RAIZ, ruta), "rb") as f:
            h.update(f.read())
    # Rutas relativas a web/, donde vive el service worker.
    relativas = [r[len("web/"):] if r.startswith("web/") else "../" + r for r in lista]
    with open(SW, encoding="utf-8") as f:
        texto = f.read()
    texto = re.sub(r'const VERSION = ".*?";', f'const VERSION = "{h.hexdigest()[:12]}";', texto)
    texto = re.sub(r"const ARCHIVOS = \[.*?\];",
                   "const ARCHIVOS = [\n" + "".join(f'  "{r}",\n' for r in ["./"] + relativas) + "];",
                   texto, flags=re.S)
    with open(SW, "w", encoding="utf-8") as f:
        f.write(texto)
    print(f"{len(relativas)} archivos, versión {h.hexdigest()[:12]}")


if __name__ == "__main__":
    main()
