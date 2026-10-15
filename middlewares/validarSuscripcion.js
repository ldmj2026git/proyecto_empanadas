// middlewares/validarSuscripcion.js
const Local = require("../models/Local");
const Empresa = require("../models/Empresa");

async function validarSuscripcion(req, res, next) {
    try {
        const { localId, telefonoLocal } = req.body;

        // 1. Buscar local por ID o por número de WhatsApp receptor
        let local;
        if (localId) {
            local = await Local.findById(localId).populate("empresaId");
        } else if (telefonoLocal) {
            local = await Local.findOne({ telefonoWhatsapp: telefonoLocal }).populate("empresaId");
        }

        if (!local) {
            return res.status(404).json({ 
                mensaje: "No se encontró ningún local registrado para los datos proporcionados" 
            });
        }

        const empresa = local.empresaId;

        if (!empresa) {
            return res.status(404).json({ mensaje: "Empresa no asociada al local" });
        }

        // 2. Verificar estado de la prueba / suscripción
        const ahora = new Date();

        if (empresa.estadoSuscripcion === "suspendida") {
            return res.status(403).json({ 
                mensaje: "El servicio de este local se encuentra suspendido. Contacte a soporte." 
            });
        }

        if (empresa.estadoSuscripcion === "trial" && ahora > empresa.fechaFinTrial) {
            empresa.estadoSuscripcion = "suspendida";
            await empresa.save();

            return res.status(403).json({ 
                mensaje: "El periodo de prueba de 7 días ha finalizado. Actualice su suscripción para continuar." 
            });
        }

        // Inyectar local y empresa en el objeto req
        req.local = local;
        req.empresa = empresa;

        next();
    } catch (error) {
        res.status(500).json({ 
            mensaje: "Error al validar la suscripción del local", 
            error: error.message 
        });
    }
}

module.exports = validarSuscripcion;