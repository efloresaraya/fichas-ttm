"""Herramienta de desarrollo: se usó UNA vez para medir las páginas 39 y 40.

Lee geometría (trazos, textos y círculos) del PDF original y devuelve estructuras
de Python. La aplicación NO la usa ni necesita el PDF para funcionar.
"""
import fitz

PAGINAS = (38, 39)  # índice 0: páginas 39 y 40


def _hex(c):
    return None if c is None else "#%02x%02x%02x" % tuple(round(v * 255) for v in c)


def _n(v):
    return ("%.2f" % v).rstrip("0").rstrip(".")


def vectores(pagina):
    salida = []
    for g in pagina.get_drawings():
        d = []
        ultimo = None
        for it in g["items"]:
            if it[0] == "l":
                if not ultimo or abs(ultimo.x - it[1].x) + abs(ultimo.y - it[1].y) > 0.01:
                    d.append("M%s %s" % (_n(it[1].x), _n(it[1].y)))
                d.append("L%s %s" % (_n(it[2].x), _n(it[2].y)))
                ultimo = it[2]
            elif it[0] == "re":
                r = it[1]
                d.append("M%s %sH%sV%sH%sZ" % (_n(r.x0), _n(r.y0), _n(r.x1), _n(r.y1), _n(r.x0)))
            else:
                raise ValueError(it[0])
        fill = _hex(g.get("fill")) if g["type"] in ("f", "fs") else None
        stroke = _hex(g.get("color")) if g["type"] in ("s", "fs") else None
        if fill == "#ffffff" and g["rect"].width > 500:
            continue
        salida.append(["".join(d), fill, stroke, round(g.get("width") or 0, 2)])
    return salida


def _familia(fuente):
    if "Trebuchet" in fuente:
        f = "t"
    elif "Helvetica" in fuente:
        f = "h"
    else:
        f = "a"
    if "Bold" in fuente:
        f += "b"
    if "Italic" in fuente:
        f += "i"
    return f


def textos_y_glifos(pagina):
    textos, glifos = [], []
    for bloque in pagina.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for linea in bloque.get("lines", []):
            for s in linea["spans"]:
                if "Unicode" in s["font"] or "Lucida" in s["font"]:
                    for ch in s["chars"]:
                        w = ch["bbox"][2] - ch["bbox"][0]
                        if "Lucida" in s["font"]:
                            glifos.append(("gde", ch["origin"][0], ch["origin"][1], w))
                        elif w > 10:
                            glifos.append(("ns", ch["bbox"][0], ch["origin"][1], w, ord(ch["c"])))
                        elif w > 7:
                            glifos.append(("op", ch["bbox"][0], ch["origin"][1], w))
                    continue
                seg = []
                def cerrar():
                    while seg and seg[-1]["c"] == " ":
                        seg.pop()
                    while seg and seg[0]["c"] == " ":
                        seg.pop(0)
                    if seg:
                        t = "".join(c["c"] for c in seg)
                        textos.append([round(seg[0]["bbox"][0], 2), round(seg[0]["origin"][1], 2),
                                       t, _familia(s["font"]), s["size"],
                                       round(seg[-1]["bbox"][2] - seg[0]["bbox"][0], 2)])
                    seg.clear()
                for i, ch in enumerate(s["chars"]):
                    sig = s["chars"][i + 1]["c"] if i + 1 < len(s["chars"]) else ""
                    if ch["c"] == "\t" or (ch["c"] == " " and sig in (" ", "\t")):
                        cerrar()
                    else:
                        seg.append(ch)
                cerrar()
    return textos, glifos


def leer(ruta):
    doc = fitz.open(ruta)
    return [dict(zip(("textos", "glifos"), textos_y_glifos(doc[i])), vectores=vectores(doc[i])) for i in PAGINAS]
