const express = require("express");
const router = express.Router();
const Producto = require("../models/Producto");   // Ajusta las rutas según tu estructura
const Pedido = require("../models/Pedido");
const { enviarMensajeWhatsApp } = require("../services/notificaciones");
const { verificarToken } = require("../middlewares/auth");
const Local = require("../models/Local");
router.use(verificarToken); // Aplica el middleware de autenticación a todas las rutas

// ====================================================
// 1. GESTIÓN DE CATÁLOGO / PRODUCTOS
// ====================================================

// Listar todos los productos de un local
router.get("/productos", async (req, res) => {
    try {
        const { localId } = req.query;
        if (!localId) return res.status(400).json({ ok: false, mensaje: "localId es requerido" });

        const productos = await Producto.find({ localId }).sort({ nombre: 1 });
        res.json({ ok: true, productos });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Crear un nuevo producto
router.post("/productos", async (req, res) => {
    try {
        const { localId, nombre, descripcion, precio, stock, activo } = req.body;
        
        const nuevoProducto = new Producto({
            localId,
            nombre,
            descripcion,
            precio,
            stock,
            activo: activo !== undefined ? activo : true
        });

        await nuevoProducto.save();
        res.status(201).json({ ok: true, producto: nuevoProducto });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Editar un producto (precio, stock, pausar/activar)
router.put("/productos/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const productoActualizado = await Producto.findByIdAndUpdate(
            id,
            { $set: req.body },
            { returnDocument: "after" }
        );

        if (!productoActualizado) {
            return res.status(404).json({ ok: false, mensaje: "Producto no encontrado" });
        }

        res.json({ ok: true, producto: productoActualizado });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ====================================================
// 2. GESTIÓN DE PEDIDOS
// ====================================================

// Listar pedidos filtrados por local, estado o fecha
router.get("/pedidos", async (req, res) => {
    try {
        const { localId, estado, fecha } = req.query;
        if (!localId) return res.status(400).json({ ok: false, mensaje: "localId es requerido" });

        const filtro = { localId };
        if (estado) filtro.estado = estado;
        if (fecha) {
            const inicioFecha = new Date(fecha);
            const finFecha = new Date(fecha);
            finFecha.setHours(23, 59, 59, 999);
            filtro.fechaRetiro = { $gte: inicioFecha,$lte: finFecha };
        }

        const pedidos = await Pedido.find(filtro).sort({ createdAt: -1 });
        res.json({ ok: true, total: pedidos.length, pedidos });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Cambiar estado del pedido y notificar al cliente vía WhatsApp
router.put("/pedidos/:id/estado", async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body; 
        // Estados permitidos: "en_preparacion", "listo", "entregado", "cancelado"

        const pedido = await Pedido.findByIdAndUpdate(
            id,
            { $set: { estado } },
            { returnDocument: "after" }
        );

        if (!pedido) {
            return res.status(404).json({ ok: false, mensaje: "Pedido no encontrado" });
        }

        // Notificaciones automáticas por cambio de estado
        if (estado === "en_preparacion") {
            await enviarMensajeWhatsApp(
                pedido.cliente.telefono,
                `👨‍🍳 Tu pedido *#${pedido.numeroPedido}* ya está en preparación.`
            );
        } else if (estado === "listo") {
            const mensajeListo = pedido.tipoEntrega === "delivery"
                ? `🛵 Tu pedido *#${pedido.numeroPedido}* está listo y en camino a tu dirección.`
                : `🛍️ Tu pedido *#${pedido.numeroPedido}* está listo para ser retirado en el local.`;
            
            await enviarMensajeWhatsApp(pedido.cliente.telefono, mensajeListo);
        } else if (estado === "entregado") {
            await enviarMensajeWhatsApp(
                pedido.cliente.telefono,
                `✅ Tu pedido *#${pedido.numeroPedido}* fue entregado. ¡Gracias por tu compra!`
            );
        }

        res.json({ ok: true, pedido });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.get("/locales", async (req, res) => {
    try {
        const locales = await Local.find().sort({ nombre: 1 });
        res.json({ ok: true, locales });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

module.exports = router;