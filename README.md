# Fichas CD/TTM

Sistema local para rellenar el Formulario de Examen CD/TTM (páginas 39 y 40 del instrumento en español).
El formulario está reconstruido en código (SVG y JavaScript): la aplicación no abre ni usa ningún PDF como base.

## Abrir

Doble clic en `iniciar.command`. La primera vez instala lo necesario y requiere internet.
El sistema se abre en http://127.0.0.1:8757.
Para generar PDF hace falta Chrome, Edge o Chromium instalado.

## Uso

1. Crea un paciente y abre una **Nueva ficha**: nombre y fecha se rellenan solos.
2. **Marcar y escribir**: clic en N/S o en una opción la pinta con el color elegido; otro clic la quita.
3. **Lápiz, Resaltador, Texto libre y Borrador** actúan sobre cualquier parte de la hoja.
4. Cada cambio se guarda solo. **Generar PDF** reconstruye la ficha desde la base elegida.

## Bases de datos

| Base | Archivo | Cómo guarda la ficha |
|---|---|---|
| SQLite | `datos/fichas.sqlite` | Una fila por campo, trazo y texto |
| DuckDB | `datos/fichas.duckdb` | Documento JSON completo |

Si una base falla, la otra sigue guardando y la pantalla lo avisa. Al volver, la base atrasada se pone al día.
Para más seguridad, guarda DuckDB en otro disco con las variables `FICHA_DUCKDB` y `FICHA_SQLITE`.
Los archivos no están cifrados: protege este equipo y sus respaldos.

## Acceso desde otro equipo de la red

1. En este computador abre **Acceso en red**, crea una contraseña y copia la dirección que aparece.
2. Si macOS pregunta si Python puede aceptar conexiones entrantes, elige **Permitir**.
3. En el otro equipo, conectado a la misma red, abre esa dirección y escribe la contraseña.

Este computador debe estar encendido, sin suspenderse y con el sistema abierto.
La conexión usa HTTP sin cifrar: úsala solo en una red privada de confianza, nunca en Wi-Fi pública ni abierta a internet.

## Usarlo como app en el celular

Con el servidor encendido y el celular en la misma red:

- **iPhone:** abre la dirección en Safari > Compartir > **Agregar a inicio**.
- **Android:** abre la dirección en Chrome > menú ⋮ > **Agregar a la pantalla principal**.

Queda un icono "Fichas TTM" que abre el sistema a pantalla completa. Los datos siguen en este Mac:
la app solo funciona cuando el Mac está encendido y el celular está en la misma red.

## Hacia una app de tienda (Android/iOS)

| Camino | Qué falta | Funciona sin el Mac |
|---|---|---|
| App web instalable (actual) | Nada | No |
| App de tienda con Capacitor que abre el sistema | Servidor en internet con HTTPS y cuentas por usuario | Sí, con internet |
| App que guarda todo en el celular | Reescribir el servidor y las bases en el dispositivo | Sí, sin internet |

## Reconstruir PDF desde una base

```bash
.venv/bin/python reconstruir.py --base sqlite --salida pdf_sqlite
```

```bash
.venv/bin/python reconstruir.py --base duckdb --salida pdf_duckdb
```

## Pruebas

```bash
.venv/bin/python -m unittest discover tests
```

## Estructura

- `static/js/plantilla.js`: el formulario como código, con los 295 puntos de marcado y escritura.
- `static/js/render.js`: dibuja la ficha; lo comparten el editor y el PDF.
- `static/js/ficha.js`: herramientas de marcado, pintura y guardado.
- `bases.py`, `app.py`, `pdf.py`, `reconstruir.py`: almacenamiento, servidor y PDF.
- `herramientas/`: scripts usados una vez para medir el formulario y dibujar los iconos; la aplicación no los usa.
- `referencia/`: páginas 39 y 40 originales, solo para comparar.
