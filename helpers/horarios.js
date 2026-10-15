const BloqueHorario = require("../models/BloqueHorario"); // Ajusta si la ruta a tu modelo BloqueHorario es distinta

async function buscarBloqueHorario(fecha, hora, localId) {
    try {
        if (!localId) {
            console.error("buscarBloqueHorario: localId es obligatorio");
            return null;
        }

        // Manejo de fecha seguro manteniendo la hora local sin desfasar UTC
        const d = new Date(fecha);
        const inicioDia = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        const finDia = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

        const bloque = await BloqueHorario.findOne({
            localId: localId,
            fecha: { $gte: inicioDia, $lte: finDia },
            horaInicio: { $lte: hora },
            horaFin: { $gte: hora }
        });

        return bloque;
    } catch (error) {
        console.error("Error al buscar bloque horario:", error);
        return null;
    }
}

module.exports = {
    buscarBloqueHorario
};