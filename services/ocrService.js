const { createWorker } = require('tesseract.js');

function procesarTextoAJSON(textoSucio) {
  const lineas = textoSucio.split('\n');
  const listaProductos = [];
  let lineasAcumuladas = [];

  // Expresión regular para buscar precios chilenos (ej: $8.990, | 8.990, 8.990)
  const patronPrecio = /(?:\$|\||s)?\s?(\d{1,2}\.\d{3})/i;

  lineas.forEach((linea) => {
    let lineaLimpia = linea.trim();
    if (!lineaLimpia) return;

    const coincidenciaPrecio = lineaLimpia.match(patronPrecio);

    if (coincidenciaPrecio) {
      const textoPrecioCompleto = coincidenciaPrecio[0];
      const precioNumero = parseInt(coincidenciaPrecio[1].replace(/\./g, ''), 10);

      const textoJuntoAlPrecio = lineaLimpia
        .replace(textoPrecioCompleto, '')
        .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s\(\)]/g, '')
        .trim();

      if (textoJuntoAlPrecio.length > 2) {
        lineasAcumuladas.push(textoJuntoAlPrecio);
      }

      if (lineasAcumuladas.length > 0) {
        const descripcionCompleta = lineasAcumuladas.join(' ');

        listaProductos.push({
          nombre: descripcionCompleta,
          precio: precioNumero,
          stock: 10 // Valor inicial por defecto para el menú
        });

        lineasAcumuladas = [];
      }
    } else {
      const lineaFiltrada = lineaLimpia
        .replace(/[—_>ºª«»£§"'\|\]\[]/g, '')
        .trim();

      const tieneTextoValido = /[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]{2,}/.test(lineaFiltrada);

      if (tieneTextoValido) {
        lineasAcumuladas.push(lineaFiltrada);
      }
    }
  });

  return listaProductos;
}

async function extraerProductosDeImagen(urlImagen) {
  const worker = await createWorker('spa');
  const { data: { text } } = await worker.recognize(urlImagen);
  await worker.terminate();
  return procesarTextoAJSON(text);
}

module.exports = { extraerProductosDeImagen };