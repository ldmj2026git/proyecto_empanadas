const jwt = require("jsonwebtoken");

function verificarToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    // Soporta formatos "Bearer TOKEN" o el token directamente
    const token = authHeader && authHeader.startsWith("Bearer ") 
        ? authHeader.split(" ")[1] 
        : authHeader;

    if (!token) {
        return res.status(401).json({ ok: false, mensaje: "Acceso denegado. Token no proporcionado." });
    }

    try {
        const verificado = jwt.verify(token, process.env.JWT_SECRET || "secreto_por_defecto");
        req.usuario = verificado; // Guarda la sesión (id, rol, localId) en la request
        next();
    } catch (error) {
        res.status(403).json({ ok: false, mensaje: "Token inválido o expirado." });
    }
}

module.exports = { verificarToken };