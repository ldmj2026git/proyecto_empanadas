const { enviarMensajeWhatsApp } = require("./whatsappClient");

/**
 * Notificar pago exitoso al cliente y al administrador del local
 * @param {Object} pedido - Documento del pedido pagado de MongoDB
 * @param {Object} local - Documento del local asociado de MongoDB
 */
async function notificarPagoExitoso(pedido, local) {
    try {
        // 1. Mensaje para el Cliente
        let mensajeCliente = 
            `¡Pago confirmado exitosamente! 🎉\n\n` +
            `Hola ${pedido.cliente.nombre || "Cliente"}, hemos recibido el pago de tu pedido *#${pedido.numeroPedido}*.\n\n` +
            `📍 *Entrega:* ${pedido.tipoEntrega}\n` +
            `📅 *Fecha:* ${new Date(pedido.fechaRetiro).toLocaleDateString("es-CL")}\n` +
            `⏰ *Hora:* ${pedido.horaRetiro}\n` +
            `💰 *Monto Pagado:* $${pedido.total}\n\n` +
            `Tu pedido ya está siendo procesado por el local *${local.nombre}*. ¡Te avisaremos cuando esté listo!`;

        await enviarMensajeWhatsApp(pedido.cliente.telefono, mensajeCliente);

        // 2. Mensaje para el Administrador / Local
        const destinoAdmin = local.telefonoAdmin || local.telefonoWhatsapp;

        if (destinoAdmin) {
            let detalleProductos = pedido.productos
                .map(item => `• ${item.cantidad}x ${item.nombre}`)
                .join("\n");

            let mensajeAdmin = 
                `🚨 *¡NUEVO PEDIDO PAGADO!* 🚨\n\n` +
                `*Pedido #:* ${pedido.numeroPedido}\n` +
                `*Cliente:* ${pedido.cliente.nombre} (${pedido.cliente.telefono})\n` +
                `*Tipo:* ${pedido.tipoEntrega}\n`;

            if (pedido.tipoEntrega === "delivery") {
                mensajeAdmin += `*Dirección:* ${pedido.direccion}\n`;
            }

            mensajeAdmin += 
                `*Fecha/Hora Entrega:* ${new Date(pedido.fechaRetiro).toLocaleDateString("es-CL")} a las ${pedido.horaRetiro}\n\n` +
                `*Detalle del pedido:*\n${detalleProductos}\n\n` +
                `*Total Pagado:* $${pedido.total}`;

            await enviarMensajeWhatsApp(destinoAdmin, mensajeAdmin);
        }

    } catch (error) {
        console.error("Error enviando notificaciones post-pago:", error);
    }
}

module.exports = {
    notificarPagoExitoso,
    enviarMensajeWhatsApp
};