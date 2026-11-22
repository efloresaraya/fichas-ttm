// Dibuja una ficha completa en SVG a partir de PLANTILLA y del documento guardado.
// Lo usan el editor y la vista de impresión, así que el PDF es igual a lo que se ve.
const SVG_NS = "http://www.w3.org/2000/svg";
const FUENTES = {
  t: ["Trebuchet MS", 400, "normal"], tb: ["Trebuchet MS", 700, "normal"], tbi: ["Trebuchet MS", 700, "italic"],
  h: ["Helvetica, Arial", 400, "normal"], hb: ["Helvetica, Arial", 700, "normal"],
  a: ["Arial, Helvetica", 400, "normal"], ab: ["Arial, Helvetica", 700, "normal"],
};
const FUENTE_VALOR = '"Trebuchet MS", Arial, sans-serif';
const RADIO_NS = 4.85, TAM_LINEA = 10, TAM_CAJA = 13, AREA_MAX = 8.5, AREA_MIN = 5.5;

function el(tag, attrs, padre) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  if (padre) padre.appendChild(n);
  return n;
}

function dibujarPlantilla(svg, indice) {
  const pagina = PLANTILLA.paginas[indice];
  const fondo = el("g", {}, svg);
  el("rect", { width: PLANTILLA.ancho, height: PLANTILLA.alto, fill: "#fff" }, fondo);
  for (const [d, relleno, trazo, grosor] of pagina.vectores) {
    el("path", { d, fill: relleno || "none", stroke: trazo || "none", "stroke-width": grosor || 0 }, fondo);
  }
  const capas = { marcas: el("g", { class: "capa-marcas" }, svg) };
  const letras = el("g", { class: "plantilla-letras" }, svg);
  for (const [x, y, texto, fuente, tam, ancho] of pagina.textos) {
    const [familia, peso, estilo] = FUENTES[fuente];
    const t = el("text", {
      x, y, "font-family": familia, "font-size": tam, "font-weight": peso, "font-style": estilo,
      textLength: ancho, lengthAdjust: "spacing", "xml:space": "preserve",
    }, letras);
    t.textContent = texto;
  }
  for (const campo of PLANTILLA.campos) {
    if (campo.p !== indice) continue;
    if (campo.t === "ns") {
      for (const [centro, letra] of [[campo.n, "N"], [campo.s, campo.letraS || "S"]]) {
        el("circle", { cx: centro[0], cy: centro[1], r: RADIO_NS, fill: "none", stroke: "#000", "stroke-width": 0.65 }, letras);
        const t = el("text", {
          x: centro[0], y: centro[1] + 2.45, "text-anchor": "middle", "font-size": 7,
          "font-family": "Helvetica, Arial, sans-serif",
        }, letras);
        t.textContent = letra;
      }
    } else if (campo.t === "op") {
      el("circle", { cx: campo.c[0], cy: campo.c[1], r: campo.r, fill: "none", stroke: "#000", "stroke-width": 0.7 }, letras);
    }
  }
  capas.valores = el("g", { class: "capa-valores" }, svg);
  capas.trazos = el("g", { class: "capa-trazos" }, svg);
  capas.textos = el("g", { class: "capa-textos" }, svg);
  return capas;
}

function trazoRuta(pts) {
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]}h.01`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${pts[i][0]} ${pts[i][1]} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const u = pts[pts.length - 1];
  return d + `L${u[0]} ${u[1]}`;
}

function atributosTrazo(t) {
  return {
    d: trazoRuta(t.pts), fill: "none", stroke: t.c, "stroke-width": t.g,
    "stroke-linecap": "round", "stroke-linejoin": "round",
    "stroke-opacity": t.h === "resaltador" ? 0.35 : 1,
  };
}

const _lienzo = document.createElement("canvas").getContext("2d");
function anchoTexto(texto, tam) {
  _lienzo.font = `${tam}px ${FUENTE_VALOR}`;
  return _lienzo.measureText(texto).width;
}

function partirLineas(texto, ancho, tam) {
  const lineas = [];
  for (const parrafo of texto.split("\n")) {
    let actual = "";
    for (const palabra of parrafo.split(" ")) {
      const prueba = actual ? actual + " " + palabra : palabra;
      if (anchoTexto(prueba, tam) <= ancho || !actual) actual = prueba;
      else { lineas.push(actual); actual = palabra; }
    }
    lineas.push(actual);
  }
  return lineas;
}

// Devuelve el tamaño mayor con el que el comentario cabe, o null si no cabe.
function ajustarArea(texto, campo) {
  const ancho = campo.x1 - campo.x0, alto = campo.y1 - campo.y0;
  for (let tam = AREA_MAX; tam >= AREA_MIN; tam -= 0.25) {
    const lineas = partirLineas(texto, ancho, tam);
    if (lineas.length * tam * 1.2 <= alto) return { tam, lineas };
  }
  return null;
}

function tamLinea(texto, campo) {
  const ancho = campo.x1 - campo.x0;
  return Math.max(6, Math.min(TAM_LINEA, TAM_LINEA * ancho / Math.max(anchoTexto(texto, TAM_LINEA), 1)));
}

function textoValor(capa, x, y, contenido, tam, color, extra) {
  const t = el("text", { x, y, "font-size": tam, fill: color, "font-family": FUENTE_VALOR, ...extra }, capa);
  t.textContent = contenido;
  return t;
}

function pintarCampo(campo, marca, capas) {
  if (campo.t === "ns") {
    const centro = marca.v === "N" ? campo.n : campo.s;
    el("circle", { cx: centro[0], cy: centro[1], r: RADIO_NS, fill: marca.c, "fill-opacity": 0.6 }, capas.marcas);
  } else if (campo.t === "op") {
    if (marca.v === campo.valor) el("circle", { cx: campo.c[0], cy: campo.c[1], r: campo.r, fill: marca.c }, capas.marcas);
  } else if (campo.t === "cajas") {
    [...marca.v].forEach((letra, i) => {
      if (letra === " " || i >= campo.xs.length - 1) return;
      const x = (campo.xs[i] + campo.xs[i + 1]) / 2;
      textoValor(capas.valores, x, (campo.y0 + campo.y1) / 2 + TAM_CAJA * 0.36, letra, TAM_CAJA, marca.c, { "text-anchor": "middle" });
    });
  } else if (campo.t === "linea") {
    const tam = tamLinea(marca.v, campo), ancho = campo.x1 - campo.x0 - 1;
    const justo = anchoTexto(marca.v, tam) > ancho ? { textLength: ancho, lengthAdjust: "spacingAndGlyphs" } : {};
    textoValor(capas.valores, campo.x0 + 1, campo.y1 - 1.5, marca.v, tam, marca.c, justo);
  } else if (campo.t === "area") {
    const ajuste = ajustarArea(marca.v, campo) || { tam: AREA_MIN, lineas: partirLineas(marca.v, campo.x1 - campo.x0, AREA_MIN) };
    ajuste.lineas.forEach((linea, i) => {
      textoValor(capas.valores, campo.x0, campo.y0 + ajuste.tam * (1 + i * 1.2), linea, ajuste.tam, marca.c);
    });
  }
}

function pintarDocumento(doc, hojas) {
  for (const capas of hojas) Object.values(capas).forEach((c) => c.replaceChildren());
  for (const campo of PLANTILLA.campos) {
    const marca = doc.campos[campo.id];
    if (marca) pintarCampo(campo, marca, hojas[campo.p]);
  }
  for (const t of doc.trazos) el("path", atributosTrazo(t), hojas[t.p].trazos);
  for (const t of doc.textos) {
    textoValor(hojas[t.p].textos, t.x, t.y, t.t, t.tam, t.c, { "data-texto": t.id });
  }
}

function crearHoja(indice, contenedor) {
  const hoja = document.createElement("div");
  hoja.className = "hoja";
  hoja.dataset.pagina = indice;
  const svg = el("svg", { viewBox: `0 0 ${PLANTILLA.ancho} ${PLANTILLA.alto}`, xmlns: SVG_NS });
  hoja.appendChild(svg);
  contenedor.appendChild(hoja);
  return { hoja, svg, capas: dibujarPlantilla(svg, indice) };
}
