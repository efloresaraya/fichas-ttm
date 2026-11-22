"""Contraseña para entrar desde otros equipos de la red.

En datos/acceso.json solo se guarda el hash de la contraseña y la clave de sesión.
"""
import json
import os
import secrets
import socket
import subprocess
import time

from werkzeug.security import check_password_hash, generate_password_hash

from bases import RAIZ

RUTA_ACCESO = os.environ.get("FICHA_ACCESO", os.path.join(RAIZ, "datos", "acceso.json"))
MAX_FALLOS = 5
BLOQUEO_SEGUNDOS = 60
LARGO_MINIMO = 8


class Acceso:
    def __init__(self, ruta=None):
        self.ruta = ruta or RUTA_ACCESO
        self.fallos = {}
        self.datos = {}
        if os.path.exists(self.ruta):
            with open(self.ruta, encoding="utf-8") as f:
                self.datos = json.load(f)
        if "clave_sesion" not in self.datos:
            self.datos["clave_sesion"] = secrets.token_hex(32)
            self._guardar()

    def _guardar(self):
        os.makedirs(os.path.dirname(self.ruta), exist_ok=True)
        descriptor = os.open(self.ruta, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as f:
            json.dump(self.datos, f)

    @property
    def clave_sesion(self):
        return self.datos["clave_sesion"]

    @property
    def activo(self):
        return bool(self.datos.get("hash"))

    @property
    def sello(self):
        # Cambia con la contraseña: así caducan las sesiones abiertas con la anterior.
        return self.datos.get("hash", "")[-16:]

    def definir(self, contrasena):
        self.datos["hash"] = generate_password_hash(contrasena)
        self._guardar()

    def desactivar(self):
        self.datos.pop("hash", None)
        self._guardar()

    def bloqueado(self, ip):
        n, desde = self.fallos.get(ip, (0, 0))
        return n >= MAX_FALLOS and time.time() - desde < BLOQUEO_SEGUNDOS

    def verificar(self, ip, contrasena):
        if self.bloqueado(ip):
            return False
        if self.activo and check_password_hash(self.datos["hash"], contrasena):
            self.fallos.pop(ip, None)
            return True
        n, desde = self.fallos.get(ip, (0, 0))
        if time.time() - desde >= BLOQUEO_SEGUNDOS:
            n = 0
        self.fallos[ip] = (n + 1, time.time())
        return False


def nombre_local():
    """Nombre de este equipo en la red, por ejemplo mi-mac.local."""
    try:
        nombre = subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True,
                                text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""
    return f"{nombre}.local" if nombre else ""


def direcciones(puerto):
    """Direcciones con las que otro equipo de la red puede abrir el sistema."""
    salida = []
    nombre = nombre_local()
    if nombre:
        salida.append(f"http://{nombre}:{puerto}")
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no envía datos: solo elige la interfaz de red
            salida.append(f"http://{s.getsockname()[0]}:{puerto}")
    except OSError:
        pass
    return salida
