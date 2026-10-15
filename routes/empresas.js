const express = require("express");
const router = express.Router();

// Usamos '../models/' para salir de 'routes' e ingresar a 'models'
const Empresa = require("../models/Empresa");
const Local = require("../models/Local");

// 1. Crear una nueva Empresa (Inicia automáticamente sus 7 días de prueba)
router.post("/empresas", async (req, res) => {
    try {
        const { nombre, emailContacto, rut,telefonoContacto } = req.body;

        const nuevaEmpresa = new Empresa({
            nombre,
            emailContacto,
            rut,
            telefonoContacto
        });

        await nuevaEmpresa.save();

        res.status(201).json({
            mensaje: "Empresa registrada exitosamente con 7 días de prueba",
            empresa: nuevaEmpresa
        });
    } catch (error) {
        res.status(400).json({
            mensaje: "Error al registrar la empresa",
            error: error.message
        });
    }
});

// 2. Crear un Local asociado a una Empresa
router.post("/locales", async (req, res) => {
    try {
        const { empresaId, nombre, direccion, telefonoWhatsapp } = req.body;

        const empresa = await Empresa.findById(empresaId);
        if (!empresa) {
            return res.status(404).json({ mensaje: "La empresa especificada no existe" });
        }

        const nuevoLocal = new Local({
            empresaId,
            nombre,
            direccion,
            telefonoWhatsapp
        });

        await nuevoLocal.save();

        res.status(201).json({
            mensaje: "Local creado correctamente",
            local: nuevoLocal
        });
    } catch (error) {
        res.status(400).json({
            mensaje: "Error al crear el local",
            error: error.message
        });
    }
});

// GET /api/empresas
router.get("/empresas", async (req, res) => {
    try {
        const empresas = await Empresa.find();
        res.json(empresas);
    } catch (error) {
        res.status(500).json({ mensaje: "Error al obtener empresas", error: error.message });
    }
});

module.exports = router;