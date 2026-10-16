const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const {
  detectarIntencion,
  detectarProductos,
  validarStockProductos,
  agregarProductoAlCarrito,
  detectarDireccion,
  detectarFecha,
  detectarHora,
  detectarMetodoPago,
  detectarConfirmacion
} = require('../bot/funcionesBot');

const Producto = require('../models/Producto');
const Carrito = require('../models/Carrito');

// Importamos el servicio de Webpay y el modelo Pedido
const { crearTransaccion } = require('./webpay');

let Pedido;
try {
  Pedido = require('../models/Pedido');
} catch (e) {
  // Manejo preventivo si la ruta del modelo cambia
}

function obtenerRutaChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (fs.existsSync('/usr/bin/chromium')) {
    return '/usr/bin/chromium';
  }
  if (fs.existsSync('/usr/bin/chromium-browser')) {
    return '/usr/bin/chromium-browser';
  }
  return undefined;
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: obtenerRutaChromium(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

client.on('qr', (qr) => {
  // Limpieza forzada de pantalla mediante código de escape ANSI (compatible con VS Code y PowerShell)
  process.stdout.write('\x1Bc');
  console.log('══════════════════════════════════════════════════');
  console.log('⚡ ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP:');
  console.log('══════════════════════════════════════════════════');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  process.stdout.write('\x1Bc');
  console.log('🟢 Cliente de WhatsApp conectado y listo para recibir mensajes.');
});

client.on('message_create', async (msg) => {
  if (msg.fromMe) return;

  const telefono = msg.from.replace('@c.us', '');
  const textoMensaje = msg.body.trim();
  const textoLower = textoMensaje.toLowerCase();

  try {
    const productosBD = await Producto.find({ activo: true, stock: { $gt: 0 } });
    const intencion = detectarIntencion(textoLower);

    let carrito = await Carrito.findOne({ 'cliente.telefono': telefono, estado: 'activo' });

    // 1. Vaciar / Cancelar carrito
    if (textoLower === 'vaciar' || textoLower === 'cancelar' || textoLower === 'limpiar' || detectarConfirmacion(textoLower) === false) {
      if (carrito) {
        await Carrito.deleteOne({ _id: carrito._id });
        return await client.sendMessage(msg.from, "🗑️ Tu carrito ha sido vaciado. Puedes iniciar un nuevo pedido escribiendo lo que deseas.");
      } else {
        return await client.sendMessage(msg.from, "No tienes ningún carrito activo en este momento.");
      }
    }

    // 2. Confirmación final del pedido y Generación de Link de Webpay
    if (detectarConfirmacion(textoLower) === true || textoLower === 'confirmo') {
      if (!carrito || carrito.productos.length === 0) {
        return await client.sendMessage(msg.from, "No tienes un pedido activo para confirmar.");
      }

      carrito.estado = 'convertido';
      await carrito.save();

      let linkWebpay = null;

      // Si seleccionó Webpay, generamos la transacción
      if (carrito.metodoPago === 'webpay') {
        try {
          let pedido;
          if (Pedido) {
            const numeroOrdenUnico = Date.now(); // Genera un número único basado en la fecha y hora actual
            pedido = new Pedido({
              cliente: carrito.cliente,
              localId: carrito.localId,
              productos: carrito.productos,
              total: carrito.total,
              tipoEntrega: carrito.tipoEntrega,
              direccion: carrito.direccion,
              metodoPago: 'webpay',
              estadoPago: 'pendiente',
              estado: 'pendiente'
            });
            await pedido.save({ validateBeforeSave: false });
          }

          const buyOrder = `ORD-${pedido?.numeroPedido || Date.now()}`;
          const sessionId = (pedido?._id || carrito._id).toString();
          const amount = carrito.total;
          
          // Ajusta esta URL con tu IP pública, Ngrok o dominio si pruebas desde fuera de localhost
          const returnUrl = process.env.WEBPAY_RETURN_URL || `http://localhost:3000/api/pagos/webpay/retorno`;

          const respuestaWebpay = await crearTransaccion(buyOrder, sessionId, amount, returnUrl);

          if (pedido) {
            pedido.tbkToken = respuestaWebpay.token;
            await pedido.save({ validateBeforeSave: false });
          }

          linkWebpay = `${respuestaWebpay.url}?token_ws=${respuestaWebpay.token}`;
        } catch (errWebpay) {
          console.error("Error al generar transacción Webpay:", errWebpay);
        }
      }

      let resumen = "🎉 *¡Pedido registrado con éxito!*\n\n";
      if (carrito.tipoEntrega === 'delivery') {
        resumen += `• *Entrega:* Delivery (${carrito.direccion || 'Sin dirección'})\n`;
      } else {
        const horaStr = carrito.horaRetiro ? ` a las ${carrito.horaRetiro}` : '';
        resumen += `• *Entrega:* Retiro en local (${horaStr})\n`;
      }
      resumen += `• *Método de pago:* ${carrito.metodoPago || 'Por definir'}\n`;
      resumen += `• *Total a pagar:* $${carrito.total}\n\n`;

      if (linkWebpay) {
        resumen += `💳 *Para completar tu pago, haz clic en el siguiente enlace:*\n${linkWebpay}\n\n`;
        resumen += "Una vez realizado el pago, procesaremos tu orden inmediatamente.";
      } else {
        resumen += "¡Muchas gracias por tu compra! Tu pedido ya está en preparación.";
      }

      return await client.sendMessage(msg.from, resumen);
    }

    // 3. Selección de Retiro o Delivery
    if (intencion === 'seleccionar_retiro' || intencion === 'seleccionar_delivery') {
      const tipo = intencion === 'seleccionar_retiro' ? 'retiro' : 'delivery';

      if (carrito) {
        carrito.tipoEntrega = tipo;
        await carrito.save();
      }

      const msj = tipo === 'delivery'
        ? "Perfecto, opción *Delivery* seleccionada. Por favor, indícame tu dirección (ej: *'mi dirección es Av. Brasil 123'*)."
        : "Perfecto, opción *Retiro en local* seleccionada. Indícame para qué fecha y hora deseas retirar (ej: *'hoy a las 16:00'*).";

      return await client.sendMessage(msg.from, msj);
    }

    // 4. Captura de Fecha y Hora (Retiro)
    if (carrito && carrito.tipoEntrega === 'retiro' && (!carrito.fechaRetiro || !carrito.horaRetiro)) {
      const fechaDetectada = detectarFecha(textoLower);
      const horaDetectada = detectarHora(textoLower);

      if (fechaDetectada || horaDetectada || intencion === 'seleccionar_fecha') {
        if (fechaDetectada) carrito.fechaRetiro = fechaDetectada;
        if (horaDetectada) carrito.horaRetiro = horaDetectada;
        if (!carrito.horaRetiro) carrito.horaRetiro = textoMensaje;

        await carrito.save();

        return await client.sendMessage(
          msg.from,
          `📅 Horario guardado: *${carrito.horaRetiro}*.\n\n¿Cuál es tu método de pago? (*efectivo*, *transferencia*, *tarjeta* o *webpay*)`
        );
      }
    }

    // 5. Captura de Dirección (Delivery)
    if (carrito && carrito.tipoEntrega === 'delivery' && !carrito.direccion) {
      const dirDetectada = detectarDireccion(textoMensaje);
      if (dirDetectada || intencion === 'ingresar_direccion' || textoLower.includes('calle') || textoLower.includes('av')) {
        const direccionFinal = dirDetectada || textoMensaje;
        carrito.direccion = direccionFinal;
        await carrito.save();

        return await client.sendMessage(
          msg.from,
          `📍 Dirección guardada: *${direccionFinal}*.\n\n¿Cuál es tu método de pago? (*efectivo*, *transferencia*, *tarjeta* o *webpay*)`
        );
      }
    }

    // 6. Captura de Método de Pago
    if (carrito && (carrito.direccion || carrito.horaRetiro || carrito.fechaRetiro) && !carrito.metodoPago) {
      const pagoDetectado = detectarMetodoPago(textoLower);
      if (pagoDetectado || intencion === 'seleccionar_pago') {
        const pagoFinal = pagoDetectado || 'efectivo';
        carrito.metodoPago = pagoFinal;
        await carrito.save();

        return await client.sendMessage(
          msg.from,
          `💳 Método de pago guardado: *${pagoFinal}*.\n\nEscribe *'confirmo'* para procesar tu pedido.`
        );
      }
    }

    // 7. Detección de productos
    const productosDetectados = detectarProductos(textoMensaje, productosBD);

    if (productosDetectados.length > 0 && intencion !== 'saludo') {
      if (!carrito) {
        const nombreCliente = msg._data?.notifyName || 'Cliente WhatsApp';

        carrito = new Carrito({
          cliente: {
            telefono: telefono,
            nombre: nombreCliente
          },
          localId: process.env.DEFAULT_LOCAL_ID,
          productos: [],
          total: 0,
          estado: 'activo'
        });
      }

      const validacion = await validarStockProductos(carrito, productosDetectados, productosBD);

      if (!validacion.ok) {
        return await client.sendMessage(msg.from, `⚠️ ${validacion.mensaje}`);
      }

      for (const item of validacion.productos) {
        await agregarProductoAlCarrito(carrito, item.producto, item.cantidad);
      }

      let respuesta = "✅ *¡Agregado al carrito!*\n\n";
      carrito.productos.forEach(item => {
        respuesta += `• ${item.cantidad}x ${item.nombre} - $${item.precioUnitario * item.cantidad}\n`;
      });
      respuesta += `\n*Total acumulado:* $${carrito.total}\n\n`;
      respuesta += "¿Deseas agregar algo más o prefieres seleccionar *retiro* o *delivery*?";

      return await client.sendMessage(msg.from, respuesta);
    }

    // 8. Consultar Carrito
    if (intencion === 'consultar_carrito') {
      if (!carrito || carrito.productos.length === 0) {
        return await client.sendMessage(msg.from, "Tu carrito está vacío.");
      }
      let respuesta = "🛒 *Tu Carrito Actual:*\n\n";
      carrito.productos.forEach(item => {
        respuesta += `• ${item.cantidad}x ${item.nombre} - $${item.precioUnitario * item.cantidad}\n`;
      });
      respuesta += `\n*Total:* $${carrito.total}\n`;
      return await client.sendMessage(msg.from, respuesta);
    }

    // 9. Saludo / Catálogo
    if (intencion === 'saludo' || intencion === 'consultar_catalogo') {
      let respuesta = "¡Hola! Bienvenido/a 🥟\n\nEste es nuestro catálogo disponible:\n\n";
      productosBD.forEach(p => {
        respuesta += `• *${p.nombre}*: $${p.precio}\n`;
      });
      respuesta += "\nPara hacer un pedido, dime qué necesitas. Ejemplo: *'Quiero 2 de pino y 1 de queso'*.";
      return await client.sendMessage(msg.from, respuesta);
    }

    // 10. Mensaje predeterminado
    const respuestaDefault = "No logré entender tu solicitud 🤖\n\nPuedes escribir *'menú'* para ver el catálogo, indicarme tu pedido (ej: *'2 de pino'*), o escribir *'vaciar'* para reiniciar tu carrito.";
    await client.sendMessage(msg.from, respuestaDefault);

  } catch (error) {
    console.error('Error procesando el mensaje en WhatsApp:', error);
    await client.sendMessage(msg.from, "Ocurrió un error al procesar tu solicitud. Por favor intenta nuevamente.");
  }
});

const enviarMensajeWhatsApp = async (numero, mensaje) => {
  let numFormateado = numero;
  if (numFormateado.length === 9 && numFormateado.startsWith('9')) {
    numFormateado = `56${numFormateado}`;
  }
  const chatId = `${numFormateado}@c.us`;
  await client.sendMessage(chatId, mensaje);
};

client.initialize();

module.exports = { client, enviarMensajeWhatsApp };