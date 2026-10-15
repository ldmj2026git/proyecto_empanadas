const mongoose = require("mongoose");

const carritoSchema = new mongoose.Schema({

    localId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Local",
            required: [true, "El local es obligatorio"]
        },

    cliente: {
        nombre: {
            type: String,
            required: true
        },

        telefono: {
            type: String,
            required: true,
            index: true
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
        required: true,
        default: 0
    },

    tipoEntrega: {
        type: String,
        enum: ["retiro", "delivery"],
        required: false
    },

    direccion: {
        type: String,
        required: false
    },

    fechaRetiro: {
        type: Date,
        required: false
    },

    horaRetiro: {
        type: String,
        required: false
    },

    metodoPago: {
        type: String,
        enum: ["efectivo", "transferencia", "tarjeta", "webpay"],
        required: false
    },

    estado: {
        type: String,
        enum: ["activo", "convertido", "abandonado"],
        default: "activo"
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Carrito", carritoSchema);