"""Pruebas del doble almacenamiento.  Uso: .venv/bin/python -m unittest discover tests"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from bases import Almacen, BaseDuckDB, BaseSQLite, Conflicto, SinBases, huella

DOC = {
    "campos": {"paciente": {"v": "Nombre Apellido", "c": "#000000"}, "4B.der.temporal.dolor": {"v": "S", "c": "#dc2626"},
               "fecha.dia": {"v": "31", "c": "#000000"}, "fecha.mes": {"v": "10", "c": "#000000"},
               "fecha.anio": {"v": "2026", "c": "#000000"}},
    "trazos": [{"id": "a", "p": 0, "h": "lapiz", "c": "#16a34a", "g": 1.5, "pts": [[1.5, 2], [3, 4.5]]}],
    "textos": [{"id": "b", "p": 1, "x": 10, "y": 20.5, "t": "control", "c": "#111827", "tam": 9}],
}


class Pruebas(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.rutas = os.path.join(self.tmp.name, "a.sqlite"), os.path.join(self.tmp.name, "b.duckdb")
        self.al = Almacen(*self.rutas)
        self.p, _ = self.al.crear_paciente({"nombre": "Nombre Apellido"})

    def tearDown(self):
        self.tmp.cleanup()

    def test_cada_base_reconstruye_el_documento_exacto(self):
        meta, estados = self.al.crear_ficha(self.p["id"], DOC)
        self.assertTrue(all(estados.values()))
        self.assertEqual(meta["fecha_examen"], "2026-10-31")
        for nombre in ("sqlite", "duckdb"):
            leido_meta, leido = self.al.ficha(meta["id"], nombre)
            self.assertEqual(leido, DOC, nombre)
            self.assertEqual(huella(leido), leido_meta["huella"])

    def test_conflicto_de_version(self):
        meta, _ = self.al.crear_ficha(self.p["id"], DOC)
        self.al.guardar_ficha(meta["id"], DOC, 1)
        with self.assertRaises(Conflicto):
            self.al.guardar_ficha(meta["id"], DOC, 1)

    def test_base_atrasada_se_pone_al_dia(self):
        meta, _ = self.al.crear_ficha(self.p["id"], DOC)
        otro = dict(DOC, textos=[])
        self.al.bases["sqlite"].guardar_ficha(dict(meta, version=5, huella=huella(otro)), otro)
        self.assertEqual(self.al.reconciliar(), 1)
        self.assertEqual(self.al.ficha(meta["id"], "duckdb")[1], otro)
        self.assertTrue(self.al.salud()["coinciden"])

    def test_si_falla_una_base_la_otra_guarda_y_luego_se_recupera(self):
        meta, _ = self.al.crear_ficha(self.p["id"], DOC)
        duck = self.al.bases["duckdb"]
        original = duck.guardar_ficha
        duck.guardar_ficha = lambda *_: (_ for _ in ()).throw(OSError("disco"))
        otro = dict(DOC, textos=[])
        _, estados = self.al.guardar_ficha(meta["id"], otro, 1)
        self.assertEqual(estados, {"sqlite": True, "duckdb": False})
        with self.assertRaises(SinBases):
            self.al.eliminar_ficha(meta["id"])
        duck.guardar_ficha = original
        self.assertTrue(self.al.salud()["coinciden"])
        self.assertEqual(self.al.ficha(meta["id"], "duckdb")[1], otro)

    def test_una_base_borrada_se_restaura_desde_la_otra(self):
        meta, _ = self.al.crear_ficha(self.p["id"], DOC)
        for sufijo in ("", "-wal", "-shm"):
            if os.path.exists(self.rutas[0] + sufijo):
                os.remove(self.rutas[0] + sufijo)
        al = Almacen(*self.rutas)
        self.assertEqual(al.ficha(meta["id"], "sqlite")[1], DOC)
        self.assertEqual(al.paciente(self.p["id"], "sqlite")["nombre"], "Nombre Apellido")

    def test_eliminar_paciente_borra_en_ambas(self):
        meta, _ = self.al.crear_ficha(self.p["id"], DOC)
        self.al.eliminar_paciente(self.p["id"])
        for b in self.al.bases.values():
            self.assertIsNone(b.paciente(self.p["id"]))
            self.assertIsNone(b.ficha(meta["id"]))


if __name__ == "__main__":
    unittest.main()
