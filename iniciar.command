#!/bin/bash
# Doble clic para abrir el sistema. La primera vez instala lo necesario.
cd "$(dirname "$0")"
if curl -s -o /dev/null http://127.0.0.1:8757/api/salud; then
  open http://127.0.0.1:8757/
  exit 0
fi
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
fi
exec .venv/bin/python app.py
