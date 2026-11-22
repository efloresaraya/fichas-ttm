"""Herramienta de desarrollo: convierte la medición de las páginas 39-40 en código.

Uso:  python herramientas/generar_plantilla.py <ruta_al_pdf_original>
Escribe static/js/plantilla.js. La aplicación solo usa ese archivo JS.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import extraer_geometria

DESTINO = os.path.join(os.path.dirname(__file__), "..", "static", "js", "plantilla.js")

# Centro y radio de cada círculo respecto a la posición del glifo original.
NS = dict(dx=5.95, dy=-3.75, r=4.85)
OP = dict(dx=4.25, dy=-3.45, r=3.55)
GDE = dict(dx=-3.15, dy=-3.0, r=5.1)

SIDES = ("der", "izq")
MOV = ["temporal", "masetero", "atm", "otros_musc", "no_mast"]
PALP = ["temporal_post", "temporal_med", "temporal_ant", "masetero_origen",
        "masetero_cuerpo", "masetero_insercion", "polo_lateral", "alrededor_pl"]
ADIC = ["mandibular_post", "submandibular", "pterigoideo_lat", "tendon_temporal"]

# (página, sección, y mínima, y máxima, filas, columnas) por bloque de tablas N/S.
BLOQUES = [
    (0, "4B", 300, 376, MOV, ["dolor", "familiar", "cefalea"]),
    (0, "4C", 376, 446, MOV, ["dolor", "familiar", "cefalea"]),
    (0, "5A", 500, 585, MOV, ["dolor", "familiar", "cefalea"]),
    (0, "5B", 585, 660, MOV, ["dolor", "familiar", "cefalea"]),
    (0, "5C", 660, 738, MOV, ["dolor", "familiar", "cefalea"]),
    (1, "6", 0, 94.6, ["clic", "crepitacion"],
     ["ex_apertura", "ex_cierre", "paciente", "dolor_clic", "familiar"]),
    (1, "7", 94.6, 176.5, ["clic", "crepitacion"], ["examinador", "paciente", "dolor_clic", "familiar"]),
    (1, "8", 176.5, 253.5, ["mientras_abre", "max_apertura"], ["bloqueo", "red_paciente", "red_evaluador"]),
    (1, "9", 253.5, 436.9, PALP, ["dolor", "familiar", "cefalea", "referido"]),
    (1, "10", 436.9, 547.7, ADIC, ["dolor", "familiar", "referido"]),
]

OPCIONES = {
    0: [(24, 101, "1a.der.ninguno"), (83.6, 101, "1a.der.temporal"), (149.5, 101, "1a.der.otros_musc"),
        (24, 116, "1a.der.masetero"), (80.5, 116, "1a.der.atm"), (144.5, 116, "1a.der.no_mast"),
        (291, 107, "1a.izq.ninguno"), (360.6, 107, "1a.izq.temporal"), (423.1, 107, "1a.izq.otros_musc"),
        (291, 122, "1a.izq.masetero"), (358.5, 122, "1a.izq.atm"), (421.5, 122, "1a.izq.no_mast"),
        (44, 156, "1b.der.ninguno"), (93.6, 156, "1b.der.temporal"), (149.5, 156, "1b.der.otro"),
        (315.4, 156, "1b.izq.ninguno"), (372.5, 156, "1b.izq.temporal"), (433, 156, "1b.izq.otro"),
        (232, 174, "2.referencia=fdi11"), (283, 174, "2.referencia=fdi21"), (374, 174, "2.referencia=otro"),
        (91, 203, "2.sobremordida_h.negativo"), (279, 203, "2.sobremordida_v.negativo"),
        (444, 203, "2.linea_media=der"), (462, 203, "2.linea_media=izq"), (480, 203, "2.linea_media=na"),
        (175, 235, "3.patron=recto"), (247, 235, "3.patron=corregida"),
        (386, 235, "3.patron=no_corregida_der"), (470.9, 235, "3.patron=no_corregida_izq"),
        (29, 727, "5C.negativa")],
    1: [(14.5, 604, "11.dolor.ninguno"), (14.5, 614, "11.dolor.mialgia"), (14.5, 624, "11.dolor.miofascial"),
        (14.5, 634, "11.dolor.artralgia_der"), (14.5, 644, "11.dolor.artralgia_izq"),
        (14.5, 654, "11.dolor.cefalea_ttm")]
       + [(x, y + d, "11.atm_%s.%s" % (s, c)) for x, d, s in ((171.5, 0, "der"), (358.5, -2, "izq"))
          for y, c in ((577, "ninguno"), (607, "disco=con_reduccion"), (617, "disco=con_bloqueo"),
                       (627, "disco=sin_red_con_lim"), (638, "disco=sin_red_sin_lim"),
                       (648, "degenerativa"), (658, "subluxacion"))],
}

CAJAS = [
    (0, "fecha.dia", [357, 373.4, 389.8], 27, 47),
    (0, "fecha.mes", [413.8, 430.2, 446.6], 27, 47),
    (0, "fecha.anio", [470.6, 487, 503.4, 521.79, 540.21], 27, 47),
    (0, "2.sobremordida_h.mm", [141, 162.6, 184.03], 182, 206),
    (0, "2.sobremordida_v.mm", [328.02, 349.65, 371.27], 182, 206),
    (0, "2.linea_media.mm", [492.89, 514.49, 536.09], 178, 206),
    (0, "4A.mm", [57, 78.6, 100.2], 277, 301),
    (0, "4B.mm", [57, 78.6, 100.2], 328, 352),
    (0, "4C.mm", [57, 78.6, 100.2], 405, 429),
    (0, "5A.mm", [57, 77.87, 97.43], 529, 553),
    (0, "5B.mm", [57, 77.87, 97.43], 605, 629),
    (0, "5C.mm", [57, 77.87, 97.43], 682, 706),
]

LINEAS_TEXTO = [
    (0, "paciente", 50, 152.5, 34, 45.5),
    (0, "examinador", 221, 345, 34, 45.5),
]
AREAS = [(1, "12.comentarios", 10, 548, 677, 713)]


def agrupar(valores, tolerancia):
    grupos = []
    for v in sorted(valores):
        if grupos and v - grupos[-1][0] <= tolerancia:
            grupos[-1].append(v)
        else:
            grupos.append([v])
    return grupos


def indice(grupos, v):
    return next(i for i, g in enumerate(grupos) if v in g)


def pares_ns(glifos):
    enes = [g for g in glifos if g[0] == "ns" and g[4] == 32]
    eses = [g for g in glifos if g[0] == "ns" and g[4] != 32]
    return [(n, min(eses, key=lambda s: abs(s[1] - n[1] - 15.3) + abs(s[2] - n[2]) * 4)) for n in enes]


def centro(g, m):
    return [round(g[1] + m["dx"], 2), round(g[2] + m["dy"], 2)]


def construir(paginas):
    campos = []
    usados = {0: set(), 1: set()}
    for pag, seccion, ymin, ymax, filas, columnas in BLOQUES:
        pares = [p for p in pares_ns(paginas[pag]["glifos"])
                 if ymin <= p[0][2] < ymax and p[0][1] > 40]
        for lado, cond in zip(SIDES, (lambda x: x < 335, lambda x: x >= 335)):
            sel = [p for p in pares if cond(p[0][1])]
            gy = agrupar([p[0][2] for p in sel], 6)
            gx = agrupar([p[0][1] for p in sel], 9)
            assert len(gy) == len(filas), (seccion, lado, [g[0] for g in gy])
            assert len(gx) == len(columnas), (seccion, lado, [g[0] for g in gx])
            for n, s in sel:
                fila = filas[indice(gy, n[2])]
                col = columnas[indice(gx, n[1])]
                c = {"id": "%s.%s.%s.%s" % (seccion, lado, fila, col), "t": "ns", "p": pag,
                     "n": centro(n, NS), "s": centro(s, NS)}
                if seccion == "10" and lado == "izq" and fila == "mandibular_post" and col == "dolor":
                    c["letraS"] = "Y"  # así aparece impreso en el formulario original
                campos.append(c)
                usados[pag].add(id(n))
    n, s = next(p for p in pares_ns(paginas[0]["glifos"]) if p[0][1] < 110)
    campos.append({"id": "4D.terminada", "t": "ns", "p": 0, "n": centro(n, NS), "s": centro(s, NS)})

    for pag, lista in OPCIONES.items():
        textos = paginas[pag]["textos"]
        for x, y, ident in lista:
            m = OP if pag == 0 else GDE
            g = (None, x, y)
            c = centro(g, m)
            cercanos = [t for t in textos if abs(t[1] - y) < 4 and -2 < t[0] - x < 16]
            fin = max([t[0] + t[5] for t in cercanos], default=c[0] + m["r"])
            campo = {"id": ident.split("=")[0], "t": "op", "p": pag, "c": c, "r": m["r"],
                     "fin": round(fin, 1)}
            if "=" in ident:
                campo["valor"] = ident.split("=")[1]
            else:
                campo["valor"] = "1"
            campos.append(campo)

    for pag, ident, xs, y0, y1 in CAJAS:
        campos.append({"id": ident, "t": "cajas", "p": pag, "xs": xs, "y0": y0, "y1": y1})
    for pag, ident, x0, x1, y0, y1 in LINEAS_TEXTO:
        campos.append({"id": ident, "t": "linea", "p": pag, "x0": x0, "x1": x1, "y0": y0, "y1": y1})
    for pag, ident, x0, x1, y0, y1 in AREAS:
        campos.append({"id": ident, "t": "area", "p": pag, "x0": x0, "x1": x1, "y0": y0, "y1": y1})
    return campos


def main(ruta_pdf):
    paginas = extraer_geometria.leer(ruta_pdf)
    campos = construir(paginas)
    salida = {
        "ancho": 558,
        "alto": 738,
        "paginas": [{
            "vectores": p["vectores"],
            "textos": p["textos"],
        } for p in paginas],
        "campos": campos,
    }
    with open(DESTINO, "w", encoding="utf-8") as f:
        f.write("// Formulario de Examen CD/TTM (páginas 39 y 40) expresado como código.\n")
        f.write("// vectores: [ruta SVG, relleno, trazo, grosor]\n")
        f.write("// textos:   [x, línea base, texto, fuente, tamaño, ancho]\n")
        f.write("// campos:   todo lo que el odontólogo puede marcar o escribir.\n")
        f.write("const PLANTILLA = {\n")
        f.write('  "ancho": 558, "alto": 738,\n  "paginas": [\n')
        for p in salida["paginas"]:
            f.write('    {"vectores": [\n')
            f.write(",\n".join("      " + json.dumps(v, ensure_ascii=False) for v in p["vectores"]))
            f.write('\n    ], "textos": [\n')
            f.write(",\n".join("      " + json.dumps(t, ensure_ascii=False) for t in p["textos"]))
            f.write("\n    ]},\n")
        f.write('  ],\n  "campos": [\n')
        f.write(",\n".join("    " + json.dumps(c, ensure_ascii=False) for c in campos))
        f.write("\n  ]\n};\n")
    from collections import Counter
    print(Counter(c["t"] for c in campos), len({(c["id"], c.get("valor")) for c in campos}))


if __name__ == "__main__":
    main(sys.argv[1])
