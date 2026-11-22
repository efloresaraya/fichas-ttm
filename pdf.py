"""Convierte la ficha dibujada en SVG a PDF con un navegador local (sin pantalla)."""
import os
import platform
import shutil
import subprocess
import tempfile

RUTAS = {
    "Darwin": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
               "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
               "/Applications/Chromium.app/Contents/MacOS/Chromium",
               "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
    "Windows": [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"],
    "Linux": [],
}


class SinNavegador(Exception):
    pass


def buscar_navegador():
    candidatos = [os.environ.get("CHROME_PATH")] + RUTAS.get(platform.system(), [])
    candidatos += [shutil.which(n) for n in ("google-chrome", "chromium", "chromium-browser", "msedge")]
    for ruta in candidatos:
        if ruta and os.path.exists(ruta):
            return ruta
    raise SinNavegador("No se encontró Chrome, Edge o Chromium. Define CHROME_PATH.")


def generar_pdf(url):
    navegador = buscar_navegador()
    with tempfile.TemporaryDirectory() as carpeta:
        salida = os.path.join(carpeta, "ficha.pdf")
        subprocess.run([navegador, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        "--no-first-run", "--virtual-time-budget=4000",
                        f"--user-data-dir={os.path.join(carpeta, 'perfil')}",
                        f"--print-to-pdf={salida}", url],
                       capture_output=True, timeout=90, check=False)
        if not os.path.exists(salida):
            raise RuntimeError("El navegador no produjo el PDF.")
        with open(salida, "rb") as f:
            return f.read()
