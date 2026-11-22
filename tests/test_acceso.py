"""Pruebas del acceso desde la red.  Uso: .venv/bin/python -m unittest discover tests"""
import os
import secrets
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from acceso import MAX_FALLOS, Acceso
from app import crear_app, destino_seguro
from bases import Almacen

RED = {"REMOTE_ADDR": "192.168.1.50"}
CLAVE = secrets.token_urlsafe(12)


class Pruebas(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        ruta = lambda n: os.path.join(self.tmp.name, n)
        self.acceso = Acceso(ruta("acceso.json"))
        self.app = crear_app(Almacen(ruta("a.sqlite"), ruta("b.duckdb")), self.acceso)
        self.local = self.app.test_client()
        self.red = self.app.test_client()
        self.red.environ_base.update(RED)
        self.p = self.local.post("/api/pacientes", json={"nombre": "Nombre Apellido"}).get_json()["paciente"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_red_sin_contrasena_no_entra(self):
        self.assertEqual(self.red.get("/").status_code, 302)
        self.assertEqual(self.red.get("/api/salud").status_code, 401)
        self.assertEqual(self.red.post("/entrar", data={"contrasena": ""}).status_code, 200)
        self.assertEqual(self.red.get("/api/salud").status_code, 401)

    def test_red_entra_con_contrasena_y_no_configura(self):
        self.acceso.definir(CLAVE)
        self.assertEqual(self.red.post("/entrar", data={"contrasena": "mala"}).status_code, 200)
        self.assertEqual(self.red.delete(f"/api/pacientes/{self.p['id']}").status_code, 401)
        self.assertEqual(self.red.post("/entrar", data={"contrasena": CLAVE}).status_code, 302)
        self.assertEqual(self.red.get(f"/pacientes/{self.p['id']}").status_code, 200)
        self.assertEqual(self.red.get("/red").status_code, 403)
        self.acceso.definir(CLAVE + "x")  # cambiarla cierra las sesiones abiertas
        self.assertEqual(self.red.get("/").status_code, 302)

    def test_bloqueo_por_intentos(self):
        self.acceso.definir(CLAVE)
        for _ in range(MAX_FALLOS):
            self.red.post("/entrar", data={"contrasena": "mala"})
        self.assertIn("Demasiados".encode(), self.red.post("/entrar", data={"contrasena": CLAVE}).data)

    def test_local_rechaza_dominio_ajeno(self):
        self.assertEqual(self.local.get("/", headers={"Host": "ajeno.example"}).status_code, 403)
        self.assertEqual(self.local.get("/").status_code, 200)

    def test_editar_y_eliminar_paciente(self):
        r = self.local.put(f"/api/pacientes/{self.p['id']}", json={"nombre": "Otro Nombre"})
        self.assertEqual(r.get_json()["paciente"]["version"], 2)
        for base in ("sqlite", "duckdb"):
            self.assertEqual(self.app.almacen.paciente(self.p["id"], base)["nombre"], "Otro Nombre")
        self.local.post(f"/api/pacientes/{self.p['id']}/fichas", json={})
        self.assertEqual(self.local.delete(f"/api/pacientes/{self.p['id']}").status_code, 200)
        for base in ("sqlite", "duckdb"):
            self.assertIsNone(self.app.almacen.paciente(self.p["id"], base))

    def test_no_redirige_fuera(self):
        self.assertEqual(destino_seguro("//ajeno.example"), "/")
        self.assertEqual(destino_seguro("/pacientes/1"), "/pacientes/1")


if __name__ == "__main__":
    unittest.main()
