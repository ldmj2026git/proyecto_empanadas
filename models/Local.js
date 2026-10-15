const mongoose = require("mongoose");

const localSchema = new mongoose.Schema({
    empresaId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Empresa",
        required: true
    },
    nombre: { type: String, required: true }, // Ej: "Local Av. Brasil"
    direccion: { type: String, required: true },
    telefonoWhatsapp: { type: String, required: true, unique: true },
    telefonoAdmin: { type: String }, // Opcional, para notificaciones de pedidos
    activo: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("Local", localSchema);