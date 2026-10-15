const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Usuario = require("../models/Usuario");

// Registrar un usuario administrador
router.post("/registro", async (req, res) => {
    try {
        const { nombre, email, password, rol, localId } = req.body;

        const usuarioExistente = await Usuario.findOne({ email });
        if (usuarioExistente) {
            return res.status(400).json({ ok: false, mensaje: "El correo ya está registrado." });
        }

        // Encriptar contraseña
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const nuevoUsuario = new Usuario({
            nombre,
            email,
            password: passwordHash,
            rol: rol || "admin_local",
            localId
        });

        await nuevoUsuario.save();
        res.status(201).json({ ok: true, mensaje: "Usuario administrador creado exitosamente." });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Iniciar Sesión (Login)
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const usuario = await Usuario.findOne({ email, activo: true });
        if (!usuario) {
            return res.status(400).json({ ok: false, mensaje: "Credenciales inválidas." });
        }

        // Validar contraseña
        const passwordCorrecta = await bcrypt.compare(password, usuario.password);
        if (!passwordCorrecta) {
            return res.status(400).json({ ok: false, mensaje: "Credenciales inválidas." });
        }

        // Generar JWT válido por 8 horas
        const token = jwt.sign(
            {
                id: usuario._id,
                email: usuario.email,
                rol: usuario.rol,
                localId: usuario.localId
            },
            process.env.JWT_SECRET || "secreto_por_defecto",
            { expiresIn: "8h" }
        );

        res.json({
            ok: true,
            token,
            usuario: {
                id: usuario._id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol: usuario.rol,
                localId: usuario.localId
            }
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

module.exports = router;