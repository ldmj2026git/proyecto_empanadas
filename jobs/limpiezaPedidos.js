const cron = require("node-cron");
const Pedido = require("../models/Pedido"); // Ajusta la ruta a tu modelo Pedido
const Producto = require("../models/Producto"); // Ajusta la ruta a tu modelo Producto
const { buscarBloqueHorario } = require("../helpers/horarios"); // Ajusta según la ubicación de tu helper de horarios

/**
 * Tarea programada: Se ejecuta cada 5 minutos.
 * Busca pedidos en estado "pendiente_pago" o "pendiente" con más de 15 minutos de antigüedad.
 */
cron.schedule("*/5 * * * *", async () => {
    try {
        const tiempoLímite = new Date(Date.now() - 15 * 60 * 1000); // 15 minutos atrás

        // Buscar pedidos no pagados ni confirmados que expiraron
        const pedidosExpirados = await Pedido.find({
            estado: { $in: ["pendiente_pago", "pendiente"] },
            metodoPago: { $in: ["webpay", "tarjeta"] },
            createdAt: { $lt: tiempoLímite }
        });

        if (pedidosExpirados.length === 0) return;

        console.log(`[CRON] Procesando ${pedidosExpirados.length} pedidos expirados por falta de pago...`);

        for (const pedido of pedidosExpirados) {
            // 1. Marcar como expirado
            await Pedido.updateOne(
                { _id: pedido._id },
                { $set: { estado: "expirado" } }
            );

            // 2. Devolver stock de productos al inventario
            if (pedido.productos && pedido.productos.length > 0) {
                for (const item of pedido.productos) {
                    await Producto.findByIdAndUpdate(item.productoId, {
                        $inc: { stock: item.cantidad }
                    });
                }
            }

            // 3. Liberar cupo en el bloque horario
            if (pedido.fechaRetiro && pedido.horaRetiro) {
                const horario = await buscarBloqueHorario(
                    pedido.fechaRetiro,
                    pedido.horaRetiro,
                    pedido.localId
                );
                if (horario && horario.reservadas > 0) {
                    horario.reservadas -= 1;
                    await horario.save();
                }
            }

            console.log(`[CRON] Pedido #${pedido.numeroPedido} expirado. Stock y horario liberados.`);
        }
    } catch (error) {
        console.error("[CRON Error] Error al limpiar pedidos expirados:", error);
    }
});