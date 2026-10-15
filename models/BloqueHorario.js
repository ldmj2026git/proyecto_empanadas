const mongoose = require("mongoose");

const bloqueHorarioSchema = new mongoose.Schema({

    localId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Local",
            required: [true, "El local es obligatorio"]
        },
        
    fecha: {
        type: Date,
        required: true
    },

    horaInicio: {
        type: String,
        required: true
    },

    horaFin: {
        type: String,
        required: true
    },

    capacidad: {
        type: Number,
        required: true
    },

    reservadas: {
        type: Number,
        default: 0
    },

    activo: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model("BloqueHorario", bloqueHorarioSchema);