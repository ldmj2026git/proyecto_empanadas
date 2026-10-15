const mongoose = require("mongoose");



const productoSchema = new mongoose.Schema({

    localId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Local",
        required: [true, "El local es obligatorio"]
    },

    nombre: {
        type: String,
        required: true
    },

    descripcion: {
        type: String,
        required: true
    },

    precio: {
        type: Number,
        required: true
    },

    stock: {
        type: Number,
        required: true,
        default: 0
    },

    activo: {
        type: Boolean,
        default: true
    }

});

module.exports = mongoose.model("Producto", productoSchema);