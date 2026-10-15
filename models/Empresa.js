const mongoose = require("mongoose");

const empresaSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    emailContacto: { type: String, required: true, unique: true },
    telefonoContacto: { type: String, required: true },
    // Fecha en que se crea la cuenta
    fechaRegistro: { type: Date, default: Date.now },
    // Se calculan automáticamente 7 días desde la fecha de registro
    fechaFinTrial: {
        type: Date,
        default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    },
    estadoSuscripcion: {
        type: String,
        enum: ["trial", "activa", "suspendida"],
        default: "trial"
    }
}, { timestamps: true });

module.exports = mongoose.model("Empresa", empresaSchema);