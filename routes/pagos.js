const express = require("express");
const router = express.Router();
const { crearTransaccion, confirmarTransaccion } = require("../services/webpay");
const Pedido = require("../models/Pedido");

// Correcto: /webpay/iniciar
router.post("/webpay/iniciar", async (req, res) => {
    try {
        const { pedidoId } = req.body;

        const pedido = await Pedido.findById(pedidoId);
        if (!pedido) {
            return res.status(404).json({ mensaje: "Pedido no encontrado" });
        }

        const buyOrder = `ORD-${pedido.numeroPedido || Date.now()}`;
        const sessionId = pedido._id.toString();
        const amount = pedido.total;
        const returnUrl = `http://localhost:3000/api/pagos/webpay/retorno`;

        const respuestaWebpay = await crearTransaccion(buyOrder, sessionId, amount, returnUrl);

        pedido.tbkToken = respuestaWebpay.token;
        await pedido.save({ validateBeforeSave: false });

        res.json({
            mensaje: "Transacción iniciada correctamente",
            urlPago: `${respuestaWebpay.url}?token_ws=${respuestaWebpay.token}`,
            token: respuestaWebpay.token
        });

    } catch (error) {
        res.status(500).json({ mensaje: "Error al iniciar pago", error: error.message });
    }
});

// Correcto: /webpay/retorno
router.get("/webpay/retorno", async (req, res) => {
    try {
        const token = req.query.token_ws;

        if (!token) {
            return res.status(400).send("Pago cancelado o token inválido.");
        }

        const resultado = await confirmarTransaccion(token);

        if (resultado.response_code === 0 && resultado.status === "AUTHORIZED") {
            const pedido = await Pedido.findOne({ tbkToken: token });

            if (pedido) {
                pedido.metodoPago = "webpay";
                pedido.estadoPago = "pagado";
                pedido.estado = "confirmado";
                await pedido.save({ validateBeforeSave: false });
            }

            return res.send(`
                <h2>¡Pago realizado con éxito!</h2>
                <p>Orden de compra: ${resultado.buy_order}</p>
                <p>Monto: $${resultado.amount}</p>
                <p>Puedes cerrar esta ventana y regresar a tu chat de WhatsApp.</p>
            `);
        } else {
            return res.send("<h2>El pago no pudo ser autorizado. Intente nuevamente.</h2>");
        }

    } catch (error) {
        res.status(500).send(`Error al procesar la respuesta de Webpay: ${error.message}`);
    }
});

module.exports = router;