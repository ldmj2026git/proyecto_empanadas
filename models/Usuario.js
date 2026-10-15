const mongoose = require("mongoose");

const usuarioSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    rol: {
        type: String,
        enum: ["superadmin", "admin_empresa", "operador_local"],
        default: "operador_local"
    },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: "Empresa" },
    localId: { type: mongoose.Schema.Types.ObjectId, ref: "Local" },
    activo: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("Usuario", usuarioSchema);