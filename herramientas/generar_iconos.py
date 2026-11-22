"""Herramienta de desarrollo: dibuja los iconos de la app (requiere Pillow).

Uso:  python herramientas/generar_iconos.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

DESTINO = os.path.join(os.path.dirname(__file__), "..", "static", "iconos")
FUENTE = "/System/Library/Fonts/Supplemental/Trebuchet MS Bold.ttf"
FONDO, TINTA = (47, 77, 143), (255, 255, 255)


def icono(lado, margen_seguro=False):
    img = Image.new("RGB", (lado, lado), FONDO)
    d = ImageDraw.Draw(img)
    escala = 0.62 if margen_seguro else 0.78  # los iconos "maskable" se recortan en círculo
    fuente = ImageFont.truetype(FUENTE, int(lado * 0.30 * escala / 0.78))
    d.text((lado / 2, lado * 0.47), "TTM", font=fuente, fill=TINTA, anchor="mm")
    ancho = lado * 0.42 * escala / 0.78
    y = lado * 0.66
    d.rounded_rectangle((lado / 2 - ancho / 2, y, lado / 2 + ancho / 2, y + lado * 0.035),
                        radius=lado * 0.02, fill=TINTA)
    return img


if __name__ == "__main__":
    os.makedirs(DESTINO, exist_ok=True)
    for lado in (192, 512):
        icono(lado).save(os.path.join(DESTINO, f"icono-{lado}.png"))
    icono(512, margen_seguro=True).save(os.path.join(DESTINO, "icono-maskable-512.png"))
    icono(180).save(os.path.join(DESTINO, "apple-touch-icon.png"))
    icono(32).save(os.path.join(DESTINO, "favicon.png"))
