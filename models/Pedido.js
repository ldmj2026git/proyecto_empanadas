const mongoose = require("mongoose");

const pedidoSchema = new mongoose.Schema({
    localId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Local",
        required: [true, "El local es obligatorio"]
    },

    numeroPedido: {
        type: Number,
        required: true,
        unique: true
    },

    cliente: {
        nombre: {
            type: String,
            required: true
        },
        telefono: {
            type: String,
            required: true
        }
    },

    productos: [
        {
            productoId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Producto",
                required: true
            },
            nombre: {
                type: String,
                required: true
            },
            cantidad: {
                type: Number,
                required: true,
                min: 1
            },
            precioUnitario: {
                type: Number,
                required: true
            }
        }
    ],

    total: {
        type: Number,
        required: true
    },

    tipoEntrega: {
        type: String,
        enum: ["retiro", "delivery"],
        required: true
    },

    direccion: {
        type: String,
        required: false
    },

    estado: {
        type: String,
        enum: [
            "pendiente",
            "pagado",
            "expirado",
            "confirmado",
            "en_preparacion",
            "listo",
            "entregado",
            "rechazado",
            "cancelado"
        ],
        default: "pendiente"
    },

    estadoPago: {
        type: String,
        enum: ["pendiente", "pagado", "rechazado"],
        default: "pendiente"
    },

    tbkToken: {
        type: String,
        required: false
    },

    datosPago: {
        tokenWs: String,
        codigoAutorizacion: String,
        monto: Number,
        tipoPago: String,
        ultimosDigitos: String,
        fechaPago: Date
    },

    fechaRetiro: {
        type: Date,
        required: true
    },

    horaRetiro: {
        type: String,
        required: true
    },

    metodoPago: {
        type: String,
        enum: ["efectivo", "transferencia", "tarjeta", "webpay"],
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Pedido", pedidoSchema);