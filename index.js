require("dotenv").config();
require("./jobs/limpiezaPedidos"); 
require("./services/whatsappClient.js");
const express = require("express");
const mongoose = require("mongoose");
const { WebpayPlus, Options, Environment } = require("transbank-sdk");
const { notificarPagoExitoso } = require("./services/notificaciones.js");
const rutasAdmin = require("./routes/admin");
const rutasAuth = require("./routes/auth");
const { buscarBloqueHorario } = require("./helpers/horarios");
const { extraerProductosDeImagen } = require("./services/ocrService");
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL;
const admin = require("firebase-admin");

const { crearTransaccion, confirmarTransaccion } = require("./services/webpay");    

// 1. Modelos y funciones
const Producto = require("./models/Producto");
const Pedido = require("./models/Pedido");
const BloqueHorario = require("./models/BloqueHorario");
const Carrito = require("./models/Carrito");
const Local = require("./models/Local");
const {
    detectarCantidad,
    detectarProducto,
    detectarProductos,
    buscarProducto,
    obtenerCatalogo,
    agregarProductoAlCarrito,
    quitarProductoDelCarrito,
    detectarIntencion,
    validarStockProductos,
    detectarDireccion,
    detectarFecha,
    detectarHora,
    detectarMetodoPago,
    detectarConfirmacion
} = require("./bot/funcionesBot");

const validarSuscripcion = require("./middlewares/validarSuscripcion");
const empresasRouter = require("./routes/empresas");
const pagosRouter = require("./routes/pagos");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", empresasRouter);
app.use("/api/pagos", pagosRouter);
app.use("/api/admin", rutasAdmin);
app.use("/api/auth", rutasAuth);
app.use("/api/admin", rutasAdmin);
app.use(express.static("public"));
const PORT = process.env.PORT || 3000;

// Inicializar Firebase Admin SDK con la variable de entorno
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin SDK inicializado correctamente.");
  } catch (err) {
    console.error("❌ Error al procesar FIREBASE_SERVICE_ACCOUNT:", err.message);
  }
}

if (!MONGO_URI) {
    console.error("❌ ERROR CRÍTICO: No se ha configurado MONGODB_URI ni MONGO_URL en las Variables de Railway.");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => {
            console.log("✅ MongoDB conectado correctamente");
            app.listen(PORT, () => {
                console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
            });
        })
        .catch((error) => {
            console.error("❌ Error al conectar con MongoDB:", error.message);
        });
}

async function generarNumeroPedido() {
    const ultimoPedido = await Pedido.findOne().sort({ numeroPedido: -1 });

    if (!ultimoPedido) {
        return 1001;
    }

    return ultimoPedido.numeroPedido + 1;
}


// ================================================================
// OBTENER LISTA DE LOCALES (Para el selector desplegable)
// ================================================================
app.get("/api/locales", async (req, res) => {
    try {
        const locales = await Local.find({ activo: true }).populate("empresaId", "nombre");
        res.json(locales);
    } catch (error) {
        res.status(500).json({ mensaje: "Error al obtener los locales", error: error.message });
    }
});

// ================================================================
// CREAR PEDIDO DESDE CARRITO
// ================================================================
async function crearPedidoDesdeCarrito(carrito) {
    if (!carrito || !carrito.productos || carrito.productos.length === 0) {
        return { ok: false, mensaje: "El carrito está vacío." };
    }
    if (!carrito.cliente || !carrito.cliente.nombre || !carrito.cliente.telefono) {
        return { ok: false, mensaje: "Faltan los datos del cliente (nombre y teléfono)." };
    }
    if (!carrito.tipoEntrega) {
        return { ok: false, mensaje: "Debes seleccionar retiro o delivery." };
    }
    if (carrito.tipoEntrega === "delivery" && !carrito.direccion) {
        return { ok: false, mensaje: "Falta la dirección de delivery." };
    }
    if (!carrito.fechaRetiro) {
        return { ok: false, mensaje: "Falta seleccionar la fecha." };
    }
    if (!carrito.horaRetiro) {
        return { ok: false, mensaje: "Falta seleccionar la hora." };
    }
    if (!carrito.metodoPago) {
        return { ok: false, mensaje: "Falta seleccionar el método de pago." };
    }

    for (const item of carrito.productos) {
        const producto = await Producto.findById(item.productoId);
        if (!producto) return { ok: false, mensaje: `El producto ${item.nombre} ya no existe.` };
        if (!producto.activo) return { ok: false, mensaje: `${producto.nombre} ya no está disponible.` };
        if (item.cantidad > producto.stock) {
            return { ok: false, mensaje: `Ya no hay suficiente stock de ${producto.nombre}. Stock disponible: ${producto.stock}.` };
        }
    }

    const horario = await buscarBloqueHorario(carrito.fechaRetiro, carrito.horaRetiro, carrito.localId);
    if (!horario) return { ok: false, mensaje: `No existe un bloque horario que incluya las ${carrito.horaRetiro}.` };
    if (horario.reservadas >= horario.capacidad) return { ok: false, mensaje: "Lo siento, ese horario ya está completo." };

    const numeroPedido = await generarNumeroPedido();

    const nuevoPedido = new Pedido({
        localId: carrito.localId,
        numeroPedido: numeroPedido,
        cliente: { nombre: carrito.cliente.nombre, telefono: carrito.cliente.telefono },
        productos: carrito.productos.map(item => ({
            productoId: item.productoId,
            nombre: item.nombre,
            cantidad: item.cantidad,
            precioUnitario: item.precioUnitario
        })),
        total: carrito.total,
        tipoEntrega: carrito.tipoEntrega,
        direccion: carrito.direccion,
        estado: "pendiente",
        fechaRetiro: carrito.fechaRetiro,
        horaRetiro: carrito.horaRetiro,
        metodoPago: carrito.metodoPago
    });

    await nuevoPedido.save();

    for (const item of carrito.productos) {
        await Producto.findByIdAndUpdate(item.productoId, { $inc: { stock: -item.cantidad } });
    }

    horario.reservadas += 1;
    await horario.save();

    carrito.estado = "convertido";
    await carrito.save();

    return { ok: true, pedido: nuevoPedido, horario: horario };
}

// Conexión a MongoDB
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("MongoDB conectado correctamente");
        app.listen(PORT, () => {
            console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error("Error al conectar con MongoDB:", error);
    });

// Ruta de prueba
app.get("/", (req, res) => {
    res.json({ mensaje: "API de empanadas funcionando", estado: "OK" });
});

// Crear producto asignando su localId
app.post("/api/productos", async (req, res) => {
    try {
        const { localId, nombre, descripcion, precio, stock } = req.body;
        if (!localId) return res.status(400).json({ mensaje: "El parámetro localId es obligatorio" });

        const nuevoProducto = new Producto({ localId, nombre, descripcion, precio, stock });
        await nuevoProducto.save();
        res.status(201).json(nuevoProducto);
    } catch (error) {
        res.status(400).json({ mensaje: "Error al crear el producto", error: error.message });
    }
});

// Obtener productos filtrados por localId
app.get("/api/productos", async (req, res) => {
    try {
        const { localId, incluirInactivos } = req.query;
        let filtro = {};
        
        if (localId) filtro.localId = localId;
        if (incluirInactivos !== "true") filtro.activo = true;

        const productos = await Producto.find(filtro);
        res.json(productos);
    } catch (error) {
        res.status(500).json({ mensaje: "Error al obtener productos", error: error.message });
    }
});

// ================================================================
// OCR: ESCANEAR IMAGEN DE MENÚ (Devuelve el borrador JSON)
// ================================================================
app.post("/api/productos/escanear-menu", async (req, res) => {
    try {
        const { urlImagen } = req.body;
        if (!urlImagen) return res.status(400).json({ mensaje: "Debes proporcionar la URL de la imagen del menú." });

        console.log("📷 Procesando imagen de menú con OCR...");
        const productosExtraidos = await extraerProductosDeImagen(urlImagen);

        res.json({
            ok: true,
            mensaje: "Menú procesado exitosamente. Revisa y corrige los datos antes de guardarlos.",
            totalDetectados: productosExtraidos.length,
            productos: productosExtraidos
        });
    } catch (error) {
        console.error("Error al procesar la imagen:", error);
        res.status(500).json({ mensaje: "Error al procesar la imagen del menú", error: error.message });
    }
});

// ================================================================
// OCR: GUARDAR (BORRADOR O PUBLICADO) EN MONGO DB
// ================================================================
app.post("/api/productos/guardar-menu", async (req, res) => {
    try {
        const { localId, productos, estado } = req.body; // estado: 'borrador' | 'publicado'

        if (!localId) {
            return res.status(400).json({ mensaje: "El parámetro localId es obligatorio." });
        }

        if (!productos || !Array.isArray(productos) || productos.length === 0) {
            return res.status(400).json({ mensaje: "Debes enviar una lista válida de productos." });
        }

        const esBorrador = estado === "borrador";
        const resultados = [];

        for (const prod of productos) {
            const productoGuardado = await Producto.findOneAndUpdate(
                { localId: localId, nombre: new RegExp(`^${prod.nombre.trim()}$`, "i") },
                {
                    localId: localId,
                    nombre: prod.nombre.trim(),
                    precio: prod.precio,
                    stock: prod.stock !== undefined ? prod.stock : 10,
                    activo: !esBorrador // Si es borrador queda inactivo temporalmente hasta confirmar
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            resultados.push(productoGuardado);
        }

        const mensaje = esBorrador
            ? `🟡 Borrador guardado exitosamente (${resultados.length} productos). Podrá continuar editándolo más tarde.`
            : `🟢 ¡Menú confirmado y publicado oficialmente en la base de datos (${resultados.length} productos)!`;

        res.json({
            ok: true,
            mensaje,
            productosGuardados: resultados
        });

    } catch (error) {
        console.error("Error al guardar el menú:", error);
        res.status(500).json({ mensaje: "Error al guardar el menú en la base de datos", error: error.message });
    }
});

app.post("/api/carritos", async (req, res) => {
    try {
        const { localId, nombre, telefono } = req.body;

        // Desactivar carritos previos del mismo teléfono en el mismo local
        await Carrito.updateMany(
            { telefono, localId, estado: "activo" },
            { $set: { estado: "abandonado" } }
        );

        const nuevoCarrito = new Carrito({
            localId,
            cliente: { nombre, telefono },
            estado: "activo"
        });

        await nuevoCarrito.save();
        res.status(201).json(nuevoCarrito);
    } catch (error) {
        res.status(400).json({ mensaje: "Error al crear carrito", error: error.message });
    }
});

app.get("/api/carritos/:id", async (req, res) => {
    try {
        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({
                mensaje: "Carrito no encontrado"
            });
        }

        res.json(carrito);

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al buscar el carrito",
            error: error.message
        });
    }
});

app.post("/api/carritos/:id/productos", async (req, res) => {
    try {
        const { productoId, cantidad } = req.body;

        if (!Number.isInteger(cantidad) || cantidad < 1) {
            return res.status(400).json({
                mensaje: "La cantidad debe ser un número entero mayor que 0"
            });
        }

        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({
                mensaje: "Carrito no encontrado"
            });
        }

        const producto = await Producto.findById(productoId);

        if (!producto) {
            return res.status(404).json({
                mensaje: "Producto no encontrado"
            });
        }

        if (!producto.activo) {
            return res.status(400).json({
                mensaje: `El producto ${producto.nombre} no está disponible`
            });
        }

        const productoExistente = carrito.productos.find(
            item => item.productoId.toString() === producto._id.toString()
        );

        const cantidadActual = productoExistente ? productoExistente.cantidad : 0;
        const cantidadFinal = cantidadActual + cantidad;

        if (cantidadFinal > producto.stock) {
            return res.status(400).json({
                mensaje: `No hay suficiente stock de ${producto.nombre}`,
                stockDisponible: producto.stock,
                cantidadEnCarrito: cantidadActual,
                cantidadSolicitada: cantidad,
                cantidadFinal: cantidadFinal
            });
        }

        if (productoExistente) {
            productoExistente.cantidad += cantidad;
        } else {
            carrito.productos.push({
                productoId: producto._id,
                nombre: producto.nombre,
                cantidad: cantidad,
                precioUnitario: producto.precio
            });
        }

        carrito.total = 0;
        for (const item of carrito.productos) {
            carrito.total += item.precioUnitario * item.cantidad;
        }

        await carrito.save();

        res.json({
            mensaje: "Producto agregado al carrito",
            carrito: carrito
        });
    } catch (error) {
        res.status(500).json({
            mensaje: "Error al buscar carrito o producto",
            error: error.message
        });
    }
});

app.put("/api/carritos/:id/recalcular", async (req, res) => {
    try {
        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({
                mensaje: "Carrito no encontrado"
            });
        }

        carrito.total = 0;
        for (const item of carrito.productos) {
            carrito.total += item.precioUnitario * item.cantidad;
        }

        await carrito.save();

        res.json({
            mensaje: "Carrito recalculado correctamente",
            carrito: carrito
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al recalcular el carrito",
            error: error.message
        });
    }
});

app.delete("/api/carritos/:id/productos/:productoId", async (req, res) => {
    try {
        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({
                mensaje: "Carrito no encontrado"
            });
        }

        const productoIndex = carrito.productos.findIndex(
            item => item.productoId.toString() === req.params.productoId
        );

        if (productoIndex === -1) {
            return res.status(404).json({
                mensaje: "El producto no está en el carrito"
            });
        }

        carrito.productos.splice(productoIndex, 1);

        carrito.total = 0;
        for (const item of carrito.productos) {
            carrito.total += item.precioUnitario * item.cantidad;
        }

        await carrito.save();

        res.json({
            mensaje: "Producto eliminado del carrito",
            carrito: carrito
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al eliminar el producto del carrito",
            error: error.message
        });
    }
});

app.put("/api/carritos/:id/productos/:productoId", async (req, res) => {
    try {
        const { cantidad } = req.body;

        if (!Number.isInteger(cantidad) || cantidad < 1) {
            return res.status(400).json({
                mensaje: "La cantidad debe ser un número entero mayor que 0"
            });
        }

        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({
                mensaje: "Carrito no encontrado"
            });
        }

        const producto = carrito.productos.find(
            item => item.productoId.toString() === req.params.productoId
        );

        if (!producto) {
            return res.status(404).json({
                mensaje: "El producto no está en el carrito"
            });
        }

        const productoBD = await Producto.findById(req.params.productoId);

        if (!productoBD) {
            return res.status(404).json({
                mensaje: "Producto no encontrado"
            });
        }

        if (cantidad > productoBD.stock) {
            return res.status(400).json({
                mensaje: `No hay suficiente stock de ${productoBD.nombre}`,
                stockDisponible: productoBD.stock
            });
        }

        producto.cantidad = cantidad;

        carrito.total = 0;
        for (const item of carrito.productos) {
            carrito.total += item.precioUnitario * item.cantidad;
        }

        await carrito.save();

        res.json({
            mensaje: "Cantidad actualizada correctamente",
            carrito: carrito
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al actualizar la cantidad",
            error: error.message
        });
    }
});

app.put("/api/carritos/:id/entrega", async (req, res) => {
    try {
        const { tipoEntrega } = req.body;

        if (!["retiro", "delivery"].includes(tipoEntrega)) {
            return res.status(400).json({
                mensaje: "El tipo de entrega debe ser retiro o delivery"
            });
        }

        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({
                mensaje: "Carrito no encontrado"
            });
        }

        carrito.tipoEntrega = tipoEntrega;

        await carrito.save();

        res.json({
            mensaje: "Tipo de entrega actualizado correctamente",
            carrito: carrito
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al actualizar el tipo de entrega",
            error: error.message
        });
    }
});

app.put("/api/carritos/:id/horario", async (req, res) => {
    try {
        const { fechaRetiro, horaRetiro } = req.body;

        if (!fechaRetiro || !horaRetiro) {
            return res.status(400).json({
                mensaje: "La fecha y hora de retiro son obligatorias"
            });
        }

        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({
                mensaje: "Carrito no encontrado"
            });
        }

        const bloque = await buscarBloqueHorario(
            fechaRetiro,
            horaRetiro,
            carrito.localId
        );

        if (!bloque) {
            return res.status(400).json({
                mensaje: `No existe un bloque horario que incluya las ${horaRetiro}.`
            });
        }

        if (bloque.reservadas >= bloque.capacidad) {
            return res.status(400).json({
                mensaje: `El bloque de ${bloque.horaInicio} a ${bloque.horaFin} está completo.`,
                capacidad: bloque.capacidad,
                reservadas: bloque.reservadas
            });
        }

        carrito.fechaRetiro = new Date(fechaRetiro);
        carrito.horaRetiro = horaRetiro;

        await carrito.save();

        res.json({
            mensaje: `Horario actualizado correctamente. La hora ${horaRetiro} pertenece al bloque ${bloque.horaInicio} - ${bloque.horaFin}.`,
            carrito: carrito,
            bloque: {
                horaInicio: bloque.horaInicio,
                horaFin: bloque.horaFin,
                capacidad: bloque.capacidad,
                reservadas: bloque.reservadas,
                cuposDisponibles: bloque.capacidad - bloque.reservadas
            }
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al actualizar el horario",
            error: error.message
        });
    }
});

app.put("/api/carritos/:id/pago", async (req, res) => {
    try {
        const { metodoPago } = req.body;

        if (!["efectivo", "transferencia", "tarjeta"].includes(metodoPago)) {
            return res.status(400).json({
                mensaje: "El método de pago debe ser efectivo, transferencia o tarjeta"
            });
        }

        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({
                mensaje: "Carrito no encontrado"
            });
        }

        carrito.metodoPago = metodoPago;

        await carrito.save();

        res.json({
            mensaje: "Método de pago actualizado correctamente",
            carrito: carrito
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al actualizar el método de pago",
            error: error.message
        });
    }
});

app.post("/api/carritos/:id/confirmar", async (req, res) => {
    try {
        const carrito = await Carrito.findById(req.params.id);

        if (!carrito) {
            return res.status(404).json({ mensaje: "Carrito no encontrado" });
        }

        if (carrito.estado !== "activo") {
            return res.status(400).json({ mensaje: "El carrito ya fue procesado" });
        }

        const resultado = await crearPedidoDesdeCarrito(carrito);

        if (!resultado.ok) {
            return res.status(400).json({ mensaje: resultado.mensaje });
        }

        res.status(201).json({
            mensaje: "Pedido creado correctamente",
            pedido: resultado.pedido
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al confirmar el carrito",
            error: error.message
        });
    }
});

// Endpoint HTTP para enviar notificaciones push desde Postman o tu backend
app.post("/api/notificaciones/enviar", async (req, res) => {
  try {
    const { token, titulo, mensaje } = req.body;

    if (!token || !titulo || !mensaje) {
      return res.status(400).json({ ok: false, error: "Faltan datos obligatorios: token, titulo o mensaje." });
    }

    const payload = {
      token: token,
      notification: {
        title: titulo,
        body: mensaje
      }
    };

    const response = await admin.messaging().send(payload);
    res.json({ ok: true, mensaje: "Notificación enviada con éxito", messageId: response });
  } catch (error) {
    console.error("Error al enviar notificación con FCM:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/carritos/telefono/:telefono", async (req, res) => {
    try {
        const carrito = await Carrito.findOne({
            "cliente.telefono": req.params.telefono,
            estado: "activo"
        });

        if (!carrito) {
            return res.status(404).json({
                mensaje: "No existe un carrito activo para este teléfono"
            });
        }

        res.json(carrito);

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al buscar el carrito por teléfono",
            error: error.message
        });
    }
});

app.get("/api/catalogo", async (req, res) => {
    try {
        const productos = await Producto.find({
            activo: true,
            stock: { $gt: 0 }
        });

        const catalogo = productos.map(producto => ({
            id: producto._id,
            nombre: producto.nombre,
            descripcion: producto.descripcion,
            precio: producto.precio,
            stockDisponible: producto.stock
        }));

        res.json(catalogo);

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al obtener el catálogo",
            error: error.message
        });
    }
});

app.put("/api/productos/:id", async (req, res) => {
    try {
        const productoActualizado = await Producto.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                returnDocument: "after",
                runValidators: true
            }
        );

        if (!productoActualizado) {
            return res.status(404).json({
                mensaje: "Producto no encontrado"
            });
        }

        res.json(productoActualizado);

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al actualizar el producto",
            error: error.message
        });
    }
});

app.delete("/api/productos/:id", async (req, res) => {
    try {
        const productoEliminado = await Producto.findByIdAndDelete(
            req.params.id
        );

        if (!productoEliminado) {
            return res.status(404).json({
                mensaje: "Producto no encontrado"
            });
        }

        res.json({
            mensaje: "Producto eliminado correctamente",
            producto: productoEliminado
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al eliminar el producto",
            error: error.message
        });
    }
});

app.post("/api/pedidos/cotizar", async (req, res) => {
    try {
        const { productos } = req.body;

        let total = 0;
        const productosCotizados = [];

        for (const item of productos) {
            if (!Number.isInteger(item.cantidad) || item.cantidad < 1) {
                return res.status(400).json({
                    mensaje: "La cantidad debe ser un número entero mayor que 0"
                });
            }

            const producto = await Producto.findById(item.productoId);

            if (!producto) {
                return res.status(404).json({
                    mensaje: `Producto no encontrado: ${item.productoId}`
                });
            }

            if (!producto.activo) {
                return res.status(400).json({
                    mensaje: `El producto ${producto.nombre} no está disponible`
                });
            }

            if (item.cantidad > producto.stock) {
                return res.status(400).json({
                    mensaje: `No hay suficiente stock de ${producto.nombre}`,
                    stockDisponible: producto.stock
                });
            }

            const subtotal = producto.precio * item.cantidad;
            total += subtotal;

            productosCotizados.push({
                productoId: producto._id,
                nombre: producto.nombre,
                cantidad: item.cantidad,
                precioUnitario: producto.precio,
                subtotal: subtotal
            });
        }

        res.json({
            productos: productosCotizados,
            total: total
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al cotizar el pedido",
            error: error.message
        });
    }
});

app.post("/api/pedidos", async (req, res) => {
    try {
        const { localId, numeroPedido, cliente, productos, tipoEntrega, metodoPago, fechaRetiro, horaRetiro } = req.body;

        if (!localId) {
            return res.status(400).json({ mensaje: "El parámetro localId es obligatorio" });
        }

        const bloque = await buscarBloqueHorario(
            fechaRetiro,
            horaRetiro,
            localId
        );

        if (!bloque) {
            return res.status(400).json({
                mensaje: `No existe un bloque horario que incluya las ${horaRetiro}.`
            });
        }

        if (bloque.reservadas >= bloque.capacidad) {
            return res.status(400).json({
                mensaje: `El bloque de ${bloque.horaInicio} a ${bloque.horaFin} está completo.`,
                capacidad: bloque.capacidad,
                reservadas: bloque.reservadas
            });
        }

        let total = 0;
        const productosPedido = [];

        for (const item of productos) {
            if (!Number.isInteger(item.cantidad) || item.cantidad < 1) {
                return res.status(400).json({
                    mensaje: "La cantidad debe ser un número entero mayor que 0"
                });
            }

            const producto = await Producto.findById(item.productoId);

            if (!producto) {
                return res.status(404).json({
                    mensaje: `Producto no encontrado: ${item.productoId}`
                });
            }

            if (!producto.activo) {
                return res.status(400).json({
                    mensaje: `El producto ${producto.nombre} no está disponible`
                });
            }

            if (item.cantidad > producto.stock) {
                return res.status(400).json({
                    mensaje: `No hay suficiente stock de ${producto.nombre}`,
                    stockDisponible: producto.stock
                });
            }

            producto.stock -= item.cantidad;
            await producto.save();

            const subtotal = producto.precio * item.cantidad;
            total += subtotal;

            productosPedido.push({
                productoId: producto._id,
                nombre: producto.nombre,
                cantidad: item.cantidad,
                precioUnitario: producto.precio
            });
        }

        const pedido = new Pedido({
            localId,
            numeroPedido,
            cliente,
            productos: productosPedido,
            total,
            tipoEntrega,
            metodoPago,
            fechaRetiro,
            horaRetiro
        });

        const pedidoGuardado = await pedido.save();

        bloque.reservadas += 1;
        await bloque.save();

        res.status(201).json(pedidoGuardado);

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al crear el pedido",
            error: error.message
        });
    }
});

app.get("/api/pedidos", async (req, res) => {
    try {
        const pedidos = await Pedido.find();
        res.json(pedidos);
    } catch (error) {
        res.status(500).json({
            mensaje: "Error al obtener los pedidos",
            error: error.message
        });
    }
});

app.get("/api/pedidos/:id", async (req, res) => {
    try {
        const pedido = await Pedido.findById(req.params.id);

        if (!pedido) {
            return res.status(404).json({
                mensaje: "Pedido no encontrado"
            });
        }

        res.json(pedido);

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al buscar el pedido",
            error: error.message
        });
    }
});

app.put("/api/pedidos/:id/estado", async (req, res) => {
    try {
        const { estado } = req.body;

        const estadosPermitidos = [
            "pendiente",
            "en_preparacion",
            "listo",
            "entregado",
            "cancelado"
        ];

        if (!estadosPermitidos.includes(estado)) {
            return res.status(400).json({
                mensaje: "Estado no válido",
                estadosPermitidos
            });
        }

        const pedidoActualizado = await Pedido.findByIdAndUpdate(
            req.params.id,
            { estado: estado },
            {
                new: true,
                runValidators: true
            }
        );

        if (!pedidoActualizado) {
            return res.status(404).json({
                mensaje: "Pedido no encontrado"
            });
        }

        res.json(pedidoActualizado);

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al actualizar el estado",
            error: error.message
        });
    }
});

app.put("/api/pedidos/:id/cancelar", async (req, res) => {
    try {
        const pedido = await Pedido.findById(req.params.id);

        if (!pedido) {
            return res.status(404).json({ mensaje: "Pedido no encontrado" });
        }

        if (pedido.estado === "cancelado") {
            return res.status(400).json({ mensaje: "El pedido ya se encuentra cancelado" });
        }

        // 1. Devolver el stock a cada producto
        for (const item of pedido.productos) {
            await Producto.findByIdAndUpdate(item.productoId, {
                $inc: { stock: item.cantidad }
            });
        }

        // 2. Liberar el cupo del horario
        if (pedido.fechaRetiro && pedido.horaRetiro) {
            const bloque = await buscarBloqueHorario(pedido.fechaRetiro, pedido.horaRetiro, pedido.localId);
            if (bloque && bloque.reservadas > 0) {
                bloque.reservadas -= 1;
                await bloque.save();
            }
        }

        // 3. Marcar el pedido como cancelado
        pedido.estado = "cancelado";
        await pedido.save();

        res.json({
            mensaje: "Pedido cancelado correctamente",
            pedido
        });

    } catch (error) {
        console.error("Error al cancelar el pedido:", error);
        res.status(500).json({
            mensaje: "Error al cancelar el pedido",
            error: error.message
        });
    }
});

app.put("/api/pedidos/:id/productos/:productoId", async (req, res) => {
    try {
        const { cantidad } = req.body;

        if (!Number.isInteger(cantidad) || cantidad < 1) {
            return res.status(400).json({
                mensaje: "La cantidad debe ser un número entero mayor que 0"
            });
        }

        const pedido = await Pedido.findById(req.params.id);

        if (!pedido) {
            return res.status(404).json({
                mensaje: "Pedido no encontrado"
            });
        }

        if (pedido.estado !== "pendiente") {
            return res.status(400).json({
                mensaje: "El pedido no se puede modificar en su estado actual",
                estadoActual: pedido.estado
            });
        }

        const productoPedido = pedido.productos.find(
            item => item.productoId.toString() === req.params.productoId
        );

        if (!productoPedido) {
            return res.status(404).json({
                mensaje: "El producto no está en el pedido"
            });
        }

        const producto = await Producto.findById(req.params.productoId);

        if (!producto) {
            return res.status(404).json({
                mensaje: "Producto no encontrado"
            });
        }

        const diferencia = cantidad - productoPedido.cantidad;

        if (diferencia > 0) {
            if (diferencia > producto.stock) {
                return res.status(400).json({
                    mensaje: `No hay suficiente stock de ${producto.nombre}`,
                    stockDisponible: producto.stock,
                    unidadesAdicionalesSolicitadas: diferencia
                });
            }
            producto.stock -= diferencia;
        }

        if (diferencia < 0) {
            producto.stock += Math.abs(diferencia);
        }

        productoPedido.cantidad = cantidad;

        pedido.total = 0;
        for (const item of pedido.productos) {
            pedido.total += item.precioUnitario * item.cantidad;
        }

        await producto.save();
        await pedido.save();

        res.json({
            mensaje: "Cantidad del producto modificada correctamente",
            pedido: pedido
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al modificar la cantidad del producto",
            error: error.message
        });
    }
});

app.post("/api/pedidos/:id/productos", async (req, res) => {
    try {
        const { productoId, cantidad } = req.body;

        if (!Number.isInteger(cantidad) || cantidad < 1) {
            return res.status(400).json({
                mensaje: "La cantidad debe ser un número entero mayor que 0"
            });
        }

        const pedido = await Pedido.findById(req.params.id);

        if (!pedido) {
            return res.status(404).json({
                mensaje: "Pedido no encontrado"
            });
        }

        if (pedido.estado !== "pendiente") {
            return res.status(400).json({
                mensaje: "El pedido no se puede modificar en su estado actual",
                estadoActual: pedido.estado
            });
        }

        const producto = await Producto.findById(productoId);

        if (!producto) {
            return res.status(404).json({
                mensaje: "Producto no encontrado"
            });
        }

        if (!producto.activo) {
            return res.status(400).json({
                mensaje: `El producto ${producto.nombre} no está disponible`
            });
        }

        if (cantidad > producto.stock) {
            return res.status(400).json({
                mensaje: `No hay suficiente stock de ${producto.nombre}`,
                stockDisponible: producto.stock
            });
        }

        const productoExistente = pedido.productos.find(
            item => item.productoId.toString() === productoId
        );

        if (productoExistente) {
            productoExistente.cantidad += cantidad;
        } else {
            pedido.productos.push({
                productoId: producto._id,
                nombre: producto.nombre,
                cantidad: cantidad,
                precioUnitario: producto.precio
            });
        }

        producto.stock -= cantidad;

        pedido.total = 0;
        for (const item of pedido.productos) {
            pedido.total += item.precioUnitario * item.cantidad;
        }

        await producto.save();
        await pedido.save();

        res.json({
            mensaje: "Producto agregado al pedido correctamente",
            pedido: pedido
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al agregar producto al pedido",
            error: error.message
        });
    }
});

app.delete("/api/pedidos/:id/productos/:productoId", async (req, res) => {
    try {
        const pedido = await Pedido.findById(req.params.id);

        if (!pedido) {
            return res.status(404).json({
                mensaje: "Pedido no encontrado"
            });
        }

        if (pedido.estado !== "pendiente") {
            return res.status(400).json({
                mensaje: "El pedido no se puede modificar en su estado actual",
                estadoActual: pedido.estado
            });
        }

        const productoIndex = pedido.productos.findIndex(
            item => item.productoId.toString() === req.params.productoId
        );

        if (productoIndex === -1) {
            return res.status(404).json({
                mensaje: "El producto no está en el pedido"
            });
        }

        const productoPedido = pedido.productos[productoIndex];

        const producto = await Producto.findById(req.params.productoId);

        if (!producto) {
            return res.status(404).json({
                mensaje: "Producto no encontrado"
            });
        }

        producto.stock += productoPedido.cantidad;
        pedido.productos.splice(productoIndex, 1);

        pedido.total = 0;
        for (const item of pedido.productos) {
            pedido.total += item.precioUnitario * item.cantidad;
        }

        await producto.save();
        await pedido.save();

        res.json({
            mensaje: "Producto eliminado del pedido correctamente",
            pedido: pedido
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al eliminar el producto del pedido",
            error: error.message
        });
    }
});

app.put("/api/pedidos/:id/horario", async (req, res) => {
    try {
        const { fechaRetiro, horaRetiro } = req.body;

        if (!fechaRetiro || !horaRetiro) {
            return res.status(400).json({
                mensaje: "La fecha y hora de retiro son obligatorias"
            });
        }

        const pedido = await Pedido.findById(req.params.id);

        if (!pedido) {
            return res.status(404).json({
                mensaje: "Pedido no encontrado"
            });
        }

        if (pedido.estado !== "pendiente") {
            return res.status(400).json({
                mensaje: "El pedido no se puede modificar en su estado actual",
                estadoActual: pedido.estado
            });
        }

        const localId = pedido.localId || req.body.localId;

        const nuevoBloque = await buscarBloqueHorario(
            fechaRetiro,
            horaRetiro,
            localId
        );

        if (!nuevoBloque) {
            return res.status(400).json({
                mensaje: `No existe un bloque que incluya las ${horaRetiro}.`
            });
        }

        const bloqueAnterior = await buscarBloqueHorario(
            pedido.fechaRetiro,
            pedido.horaRetiro,
            localId
        );

        if (!bloqueAnterior) {
            return res.status(400).json({
                mensaje: "No se encontró el bloque horario actual del pedido"
            });
        }

        if (
            bloqueAnterior._id.toString() === nuevoBloque._id.toString() &&
            pedido.horaRetiro === horaRetiro &&
            new Date(pedido.fechaRetiro).getTime() === new Date(fechaRetiro).getTime()
        ) {
            return res.json({
                mensaje: "El pedido ya tiene ese horario",
                pedido: pedido
            });
        }

        if (nuevoBloque.reservadas >= nuevoBloque.capacidad) {
            return res.status(400).json({
                mensaje: `El bloque de ${nuevoBloque.horaInicio} a ${nuevoBloque.horaFin} está completo.`,
                capacidad: nuevoBloque.capacidad,
                reservadas: nuevoBloque.reservadas
            });
        }

        if (bloqueAnterior.reservadas > 0) {
            bloqueAnterior.reservadas -= 1;
        }

        nuevoBloque.reservadas += 1;

        pedido.fechaRetiro = new Date(fechaRetiro);
        pedido.horaRetiro = horaRetiro;

        await bloqueAnterior.save();
        await nuevoBloque.save();
        await pedido.save();

        res.json({
            mensaje: `Horario del pedido modificado correctamente. Nuevo bloque: ${nuevoBloque.horaInicio} - ${nuevoBloque.horaFin}.`,
            pedido: pedido
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al modificar el horario del pedido",
            error: error.message
        });
    }
});

app.post("/api/horarios", async (req, res) => {
    try {
        const { localId, fecha, horaInicio, horaFin, capacidad } = req.body;
        const nuevoBloque = new BloqueHorario({
            localId,
            fecha,
            horaInicio,
            horaFin,
            capacidad
        });
        await nuevoBloque.save();
        res.status(201).json(nuevoBloque);
    } catch (error) {
        res.status(400).json({ mensaje: "Error al crear bloque horario", error: error.message });
    }
});

app.get("/api/horarios", async (req, res) => {
    try {
        const horarios = await BloqueHorario.find();
        res.json(horarios);
    } catch (error) {
        res.status(500).json({
            mensaje: "Error al obtener los horarios",
            error: error.message
        });
    }
});

// ================================================================
// GESTIÓN DE HORARIOS PARA EL DASHBOARD ADMIN
// ================================================================

// 1. Obtener todos los bloques horarios de un local para una fecha específica
app.get("/api/horarios/admin", async (req, res) => {
    try {
        const { localId, fecha } = req.query;
        if (!localId || !fecha) {
            return res.status(400).json({ mensaje: "localId y fecha son requeridos." });
        }

        const inicioDia = new Date(fecha);
        inicioDia.setUTCHours(0,0,0,0);
        
        const finDia = new Date(fecha);
        finDia.setUTCHours(23,59,59,999);

        const horarios = await BloqueHorario.find({
            localId,
            fecha: { $gte: inicioDia,$lte: finDia }
        }).sort({ horaInicio: 1 });

        res.json(horarios);
    } catch (error) {
        res.status(500).json({ mensaje: "Error al obtener bloques horarios", error: error.message });
    }
});

// 2. Habilitar/Deshabilitar o Modificar un Bloque Horario
app.put("/api/horarios/:id", async (req, res) => {
    try {
        const { activo, capacidad } = req.body;
        const camposActualizar = {};

        if (activo !== undefined) camposActualizar.activo = activo;
        if (capacidad !== undefined) camposActualizar.capacidad = capacidad;

        const bloqueActualizado = await BloqueHorario.findByIdAndUpdate(
            req.params.id,
            { $set: camposActualizar },
            { new: true }
        );

        if (!bloqueActualizado) {
            return res.status(404).json({ mensaje: "Bloque horario no encontrado" });
        }

        res.json({
            ok: true,
            mensaje: `Bloque ${bloqueActualizado.horaInicio}-${bloqueActualizado.horaFin} ${bloqueActualizado.activo ? 'habilitado' : 'deshabilitado'} correctamente.`,
            bloque: bloqueActualizado
        });
    } catch (error) {
        res.status(500).json({ mensaje: "Error al actualizar el bloque horario", error: error.message });
    }
});

// Actualizar el filtro de búsqueda de horarios disponibles del bot/cliente para ignorar bloques inactivos
app.get("/api/horarios/disponibles/:fecha", async (req, res) => {
    try {
        const { localId } = req.query;
        const fecha = new Date(req.params.fecha);
        const inicioDia = new Date(fecha);
        inicioDia.setUTCHours(0,0,0,0);
        const finDia = new Date(fecha);
        finDia.setUTCHours(23,59,59,999);

        const filtro = {
            fecha: { $gte: inicioDia,$lte: finDia },
            activo: true, // Solo bloques habilitados
            $expr: {$lt: ["$reservadas", "$capacidad"] }
        };

        if (localId) filtro.localId = localId;

        const horarios = await BloqueHorario.find(filtro).sort({ horaInicio: 1 });

        const horariosDisponibles = horarios.map(horario => ({
            id: horario._id,
            horaInicio: horario.horaInicio,
            horaFin: horario.horaFin,
            cuposDisponibles: horario.capacidad - horario.reservadas
        }));

        res.json(horariosDisponibles);
    } catch (error) {
        res.status(500).json({ mensaje: "Error al obtener horarios disponibles", error: error.message });
    }
});

// ================================================================
// GESTIÓN DE HORARIOS Y GENERACIÓN DE JORNADA DE 30 MIN
// ================================================================

// Generar o completar la jornada completa de 10:00 a 20:00 en bloques de 30 min
app.post("/api/horarios/generar-jornada", async (req, res) => {
    try {
        const { localId, fecha, capacidadInicial = 5 } = req.body;
        if (!localId || !fecha) {
            return res.status(400).json({ mensaje: "El localId y la fecha son obligatorios." });
        }

        const inicioDia = new Date(fecha);
        inicioDia.setUTCHours(0, 0, 0, 0);
        const finDia = new Date(fecha);
        finDia.setUTCHours(23, 59, 59, 999);

        const bloquesCreados = [];
        let horaActual = 10;
        let minutoActual = 0;

        // Bucle desde las 10:00 hasta las 20:00
        while (horaActual < 20) {
            const hInicioStr = `${String(horaActual).padStart(2, '0')}:${String(minutoActual).padStart(2, '0')}`;
            
            let horaFin = horaActual;
            let minutoFin = minutoActual + 30;
            if (minutoFin >= 60) {
                minutoFin = 0;
                horaFin += 1;
            }
            const hFinStr = `${String(horaFin).padStart(2, '0')}:${String(minutoFin).padStart(2, '0')}`;

            // Verificar si el bloque ya existe para no duplicarlo
            const existe = await BloqueHorario.findOne({
                localId,
                fecha: { $gte: inicioDia,$lte: finDia },
                horaInicio: hInicioStr
            });

            if (!existe) {
                bloquesCreados.push({
                    localId,
                    fecha: inicioDia,
                    horaInicio: hInicioStr,
                    horaFin: hFinStr,
                    capacidad: capacidadInicial,
                    reservadas: 0,
                    activo: true
                });
            }

            minutoActual += 30;
            if (minutoActual >= 60) {
                minutoActual = 0;
                horaActual += 1;
            }
        }

        if (bloquesCreados.length > 0) {
            await BloqueHorario.insertMany(bloquesCreados);
        }

        const todosLosBloques = await BloqueHorario.find({
            localId,
            fecha: { $gte: inicioDia,$lte: finDia }
        }).sort({ horaInicio: 1 });

        res.json({
            ok: true,
            mensaje: bloquesCreados.length > 0 
                ? `Se generaron ${bloquesCreados.length} bloques de 30 min (10:00 a 20:00).`
                : "La jornada ya contaba con los bloques generados.",
            horarios: todosLosBloques
        });

    } catch (error) {
        res.status(500).json({ mensaje: "Error al generar la jornada de horarios", error: error.message });
    }
});

// ================================================================
// GESTIÓN RÁPIDA DE STOCK Y ESTADO DE PRODUCTOS
// ================================================================

// Actualizar Stock, Precio y Estado de un Producto
app.put("/api/productos/:id/stock", async (req, res) => {
    try {
        const { stock, activo, precio } = req.body;
        const datosActualizar = {};

        if (stock !== undefined) datosActualizar.stock = Number(stock);
        if (precio !== undefined) datosActualizar.precio = Number(precio);
        if (activo !== undefined) datosActualizar.activo = Boolean(activo);

        const producto = await Producto.findByIdAndUpdate(
            req.params.id,
            { $set: datosActualizar },
            { new: true }
        );

        if (!producto) {
            return res.status(404).json({ mensaje: "Producto no encontrado" });
        }

        res.json({
            ok: true,
            mensaje: `Producto '${producto.nombre}' actualizado correctamente.`,
            producto
        });
    } catch (error) {
        res.status(500).json({ mensaje: "Error al actualizar el producto", error: error.message });
    }
});


// Endpoint del bot con middleware de suscripción y aislamiento por localId
app.post("/api/bot", validarSuscripcion, async (req, res) => {
    try {
        const { telefono, mensaje } = req.body;
        const local = req.local;
        const localId = local._id;
        const responder = datos => res.json({ local: local.nombre, ...datos });

        if (!telefono || !mensaje) {
            return res.status(400).json({ mensaje: "El teléfono y mensaje son obligatorios" });
        }

        let carrito = await Carrito.findOne({
            "cliente.telefono": telefono,
            localId,
            estado: "activo"
        });

        if (!carrito) {
            carrito = new Carrito({
                localId,
                cliente: { nombre: "Cliente WhatsApp", telefono },
                estado: "activo",
                productos: []
            });
            await carrito.save();
        }

        const productosDisponibles = await Producto.find({ localId, activo: true });
        const texto = mensaje.toLowerCase().trim();
        const intencion = detectarIntencion(texto);

        if (intencion === "saludo") {
            return responder({ respuesta: "¡Hola! 👋 Bienvenido a nuestra tienda." });
        }

        if (intencion === "consultar_catalogo") {
            if (productosDisponibles.length === 0) {
                return responder({ respuesta: "En este momento no tenemos productos disponibles." });
            }

            let respuesta = "Estos son nuestros productos disponibles:\n";
            for (const producto of productosDisponibles) {
                respuesta += `• ${producto.nombre} — $${producto.precio}\n`;
                if (producto.descripcion) respuesta += `  ${producto.descripcion}\n`;
            }

            return responder({ respuesta, productos: productosDisponibles });
        }

        if (intencion === "consultar_carrito") {
            if (carrito.productos.length === 0) {
                return responder({ respuesta: "Tu carrito está vacío." });
            }

            let respuesta = "Tu carrito tiene:\n";
            for (const item of carrito.productos) {
                const subtotal = item.precioUnitario * item.cantidad;
                respuesta += `• ${item.cantidad} ${item.nombre} — $${subtotal}\n`;
            }
            respuesta += `\nTotal: $${carrito.total}`;

            return responder({ respuesta, carrito });
        }

        if (intencion === "seleccionar_retiro") {
            carrito.tipoEntrega = "retiro";
            await carrito.save();
            return responder({ respuesta: "Perfecto. Tu pedido será para retiro en el local.", carrito });
        }

        if (intencion === "seleccionar_delivery") {
            carrito.tipoEntrega = "delivery";
            await carrito.save();
            return responder({ respuesta: "Perfecto. Tu pedido será enviado por delivery.", carrito });
        }

        if (intencion === "ingresar_direccion") {
            const direccion = detectarDireccion(texto);
            if (!direccion) {
                return responder({ respuesta: "No pude identificar la dirección. Escríbela, por ejemplo: mi dirección es Avenida Brasil 123." });
            }

            carrito.direccion = direccion;
            await carrito.save();

            return responder({ respuesta: `Perfecto. Guardé tu dirección de delivery: ${direccion}.`, carrito });
        }

        if (intencion === "seleccionar_fecha") {
            const fecha = detectarFecha(texto);
            if (!fecha) {
                return responder({ respuesta: "Indícame la fecha. Por ejemplo: hoy, mañana o pasado mañana." });
            }

            carrito.fechaRetiro = fecha;
            await carrito.save();

            return responder({ respuesta: `Perfecto. La fecha seleccionada es ${fecha.toLocaleDateString("es-CL")}.`, carrito });
        }

        if (intencion === "horario" || texto.includes("hora") || detectarHora(texto)) {
            const hora = detectarHora(texto);
            if (!hora) {
                return responder({ respuesta: "Por favor indica una hora válida (ejemplo: 12:30 o 14:00)." });
            }

            if (!carrito.fechaRetiro) {
                return responder({ respuesta: "Primero debes seleccionar una fecha (por ejemplo: hoy o mañana)." });
            }

            const horario = await buscarBloqueHorario(carrito.fechaRetiro, hora, localId);
            if (!horario) {
                return responder({ respuesta: `No encontré un bloque horario disponible que incluya las ${hora} para esta fecha.` });
            }

            if (horario.reservadas >= horario.capacidad) {
                return responder({
                    respuesta: `Lo sentimos, el bloque de ${horario.horaInicio} a ${horario.horaFin} está agotado. Por favor selecciona otro horario.`
                });
            }

            carrito.horaRetiro = hora;
            await carrito.save();

            return responder({
                respuesta: `Perfecto. Reservaremos la hora ${hora}, dentro del bloque ${horario.horaInicio} - ${horario.horaFin}.`,
                carrito
            });
        }

        if (intencion === "seleccionar_pago") {
            const metodoPago = detectarMetodoPago(texto);
            if (!metodoPago) {
                return responder({ respuesta: "Indícame el método de pago: efectivo, transferencia o tarjeta (Webpay)." });
            }

            carrito.metodoPago = metodoPago;
            await carrito.save();

            return responder({ respuesta: `Perfecto. El método de pago seleccionado es ${metodoPago}.`, carrito });
        }

        if (intencion === "confirmacion") {
            const confirmacion = detectarConfirmacion(texto);

            if (confirmacion === false) {
                return responder({ respuesta: "Pedido cancelado. Tu carrito sigue disponible.", carrito });
            }

            if (carrito.productos.length === 0) return responder({ respuesta: "Tu carrito está vacío." });
            if (!carrito.tipoEntrega) return responder({ respuesta: "Primero debes seleccionar retiro o delivery." });
            if (carrito.tipoEntrega === "delivery" && !carrito.direccion) return responder({ respuesta: "Para delivery necesito tu dirección." });
            if (!carrito.fechaRetiro) return responder({ respuesta: "Primero debes indicar la fecha." });
            if (!carrito.horaRetiro) return responder({ respuesta: "Primero debes indicar el horario." });
            if (!carrito.metodoPago) return responder({ respuesta: "Primero debes seleccionar el método de pago." });

            if (confirmacion === null) {
                let resumen = "Este es el resumen de tu pedido:\n\n";
                for (const item of carrito.productos) {
                    resumen += `• ${item.cantidad} ${item.nombre} — $${item.precioUnitario * item.cantidad}\n`;
                }
                resumen += `\nTotal: $${carrito.total}`;
                resumen += `\nEntrega: ${carrito.tipoEntrega}`;
                if (carrito.tipoEntrega === "delivery") resumen += `\nDirección: ${carrito.direccion}`;
                resumen += `\nFecha: ${new Date(carrito.fechaRetiro).toLocaleDateString("es-CL")}`;
                resumen += `\nHora: ${carrito.horaRetiro}`;
                resumen += `\nPago: ${carrito.metodoPago}`;
                resumen += "\n\n¿Confirmas el pedido? Responde sí o no.";

                return responder({ respuesta: resumen, carrito });
            }

            const resultado = await crearPedidoDesdeCarrito(carrito);
            if (!resultado.ok) return responder({ respuesta: resultado.mensaje });

            const pedido = resultado.pedido;
            let urlPago = null;

            if (pedido.metodoPago === "webpay" || pedido.metodoPago === "tarjeta") {
                try {
                    const buyOrder = `ORD${pedido.numeroPedido}`;
                    const sessionId = pedido._id.toString();
                    const amount = Math.round(Number(pedido.total));
                    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
                    const returnUrl = `${baseUrl}/api/pagos/confirmar`;

                    const createResponse = await crearTransaccion(buyOrder, sessionId, amount, returnUrl);
                    if (createResponse && createResponse.url && createResponse.token) {
                        pedido.tbkToken = createResponse.token;
                        await pedido.save();
                        urlPago = `${createResponse.url}?token_ws=${createResponse.token}`;
                    }
                } catch (errorWebpay) {
                    console.error("Error al generar transacción Webpay:", errorWebpay.message);
                }
            }

            let textoRespuesta =
                `¡Pedido confirmado! 🎉\n\n` +
                `Número de pedido: #${pedido.numeroPedido}\n` +
                `Total: $${pedido.total}\n` +
                `Entrega: ${pedido.tipoEntrega}\n` +
                `Fecha: ${new Date(pedido.fechaRetiro).toLocaleDateString("es-CL")}\n` +
                `Hora: ${pedido.horaRetiro}\n` +
                `Pago: ${pedido.metodoPago}\n\n`;

            if (urlPago) {
                textoRespuesta += `💳 Para completar tu pago con Webpay, ingresa al enlace:\n${urlPago}\n\n`;
            }

            textoRespuesta += `Gracias por tu compra.`;

            return responder({ respuesta: textoRespuesta, pedido, urlPago });
        }

        if (intencion === "quitar_producto") {
            const productoBuscado = detectarProducto(texto, productosDisponibles);
            if (!productoBuscado) return responder({ respuesta: "¿Qué producto quieres quitar?" });

            const cantidad = detectarCantidad(texto);
            const resultado = await quitarProductoDelCarrito(carrito, productoBuscado, cantidad);
            if (!resultado.ok) return responder({ respuesta: resultado.mensaje });

            return responder({ respuesta: resultado.mensaje, carrito: resultado.carrito });
        }

        const productosDetectados = detectarProductos(texto, productosDisponibles);
        if (productosDetectados.length > 0) {
            const validacion = await validarStockProductos(carrito, productosDetectados, productosDisponibles);
            if (!validacion.ok) {
                return responder({ respuesta: validacion.mensaje });
            }

            for (const item of validacion.productos) {
                await agregarProductoAlCarrito(carrito, item.producto, item.cantidad);
            }

            return responder({
                respuesta: `Agregué los productos a tu carrito. Tu nuevo total es $${carrito.total}.`,
                carrito
            });
        }

        return responder({
            respuesta: "No logré entender tu mensaje. Escribe 'catálogo' para ver nuestros productos o indica el producto que deseas."
        });

    } catch (error) {
        console.error("Error en bot:", error);
        res.status(500).json({ mensaje: "Error al procesar mensaje en el bot", error: error.message });
    }
});

// Endpoint de retorno desde Webpay
app.all("/api/pagos/confirmar", async (req, res) => {
    try {
        const body = req.body || {};
        const query = req.query || {};

        const tokenWs = query.token_ws || body.token_ws;
        const tbkToken = query.TBK_TOKEN || body.TBK_TOKEN;
        const tbkOrdenCompra = query.TBK_ORDEN_COMPRA || body.TBK_ORDEN_COMPRA;

        // 1. EL USUARIO CANCELÓ EN LA PASARELA DE WEBPAY
        if (tbkToken && !tokenWs) {
            if (tbkOrdenCompra) {
                const numeroPedido = Number(tbkOrdenCompra.replace("ORD", ""));
                
                // Marcar pedido como cancelado
                const pedidoCancelado = await Pedido.findOneAndUpdate(
                    { numeroPedido: numeroPedido },
                    { $set: { estado: "cancelado" } },
                    { returnDocument: "after" }
                );

                if (pedidoCancelado) {
                    // Restablecer stock de productos
                    if (pedidoCancelado.productos) {
                        for (const item of pedidoCancelado.productos) {
                            await Producto.findByIdAndUpdate(item.productoId, {
                                $inc: { stock: item.cantidad }
                            });
                        }
                    }

                    // Liberar cupo en el bloque horario
                    if (pedidoCancelado.fechaRetiro && pedidoCancelado.horaRetiro) {
                        const horario = await buscarBloqueHorario(
                            pedidoCancelado.fechaRetiro,
                            pedidoCancelado.horaRetiro,
                            pedidoCancelado.localId
                        );
                        if (horario && horario.reservadas > 0) {
                            horario.reservadas -= 1;
                            await horario.save();
                        }
                    }
                }
            }

            return res.status(200).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head><meta charset="UTF-8"><title>Pago Cancelado</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #e74c3c;">Pago Cancelado ❌</h1>
                    <p>Has cancelado la operación en Webpay.</p>
                    <p>Tu pedido ha sido cancelado y los productos han vuelto al inventario.</p>
                </body>
                </html>
            `);
        }

        if (!tokenWs) {
            return res.status(400).send("Token de transacción no recibido.");
        }

        // 2. CONFIRMAR TRANSACCIÓN CON TRANSBANK
        let commitResponse;
        try {
            commitResponse = await confirmarTransaccion(tokenWs);
        } catch (commitError) {
            console.error("Error en commit o token ya procesado:", commitError.message);
            return res.status(400).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head><meta charset="UTF-8"><title>Transacción Procesada</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h2>Esta transacción ya fue procesada o el token ha expirado.</h2>
                </body>
                </html>
            `);
        }

        const numeroPedido = Number(commitResponse.buy_order.replace("ORD", ""));

        // 3. PAGO APROBADO / AUTORIZADO
        if (commitResponse.status === "AUTHORIZED" && commitResponse.response_code === 0) {
            
            const pedidoActualizado = await Pedido.findOneAndUpdate(
                { numeroPedido: numeroPedido },
                {
                    $set: {
                        estado: "pagado",
                        datosPago: {
                            tokenWs: tokenWs,
                            codigoAutorizacion: commitResponse.authorization_code,
                            monto: commitResponse.amount,
                            tipoPago: commitResponse.payment_type_code,
                            ultimosDigitos: commitResponse.card_detail?.card_number,
                            fechaPago: commitResponse.transaction_date
                        }
                    }
                },
                { returnDocument: "after" }
            );
            
            // 🔔 DISPARAR NOTIFICACIONES POST-PAGO
            if (pedidoActualizado) {
                const local = await Local.findById(pedidoActualizado.localId);
                if (local) {
                    // Ejecutar de forma asíncrona para no congelar la respuesta web al usuario
                    notificarPagoExitoso(pedidoActualizado, local);
                }
            }

            return res.status(200).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head><meta charset="UTF-8"><title>¡Pago Exitoso!</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #27ae60;">¡Pago Exitoso! 🎉</h1>
                    <p>Tu pedido <strong>#${numeroPedido}</strong> ha sido pagado correctamente.</p>
                    <p><strong>Monto:</strong> $${commitResponse.amount}</p>
                    <p><strong>Código de autorización:</strong> ${commitResponse.authorization_code}</p>
                </body>
                </html>
            `);

        } else {
            // 4. PAGO RECHAZADO POR BANCO / WEBPAY
            const pedidoRechazado = await Pedido.findOneAndUpdate(
                { numeroPedido: numeroPedido },
                { $set: { estado: "rechazado" } },
                { returnDocument: "after" }
            );

            if (pedidoRechazado) {
                // Restablecer stock
                if (pedidoRechazado.productos) {
                    for (const item of pedidoRechazado.productos) {
                        await Producto.findByIdAndUpdate(item.productoId, {
                            $inc: { stock: item.cantidad }
                        });
                    }
                }

                // Liberar cupo en el bloque horario
                if (pedidoRechazado.fechaRetiro && pedidoRechazado.horaRetiro) {
                    const horario = await buscarBloqueHorario(
                        pedidoRechazado.fechaRetiro,
                        pedidoRechazado.horaRetiro,
                        pedidoRechazado.localId
                    );
                    if (horario && horario.reservadas > 0) {
                        horario.reservadas -= 1;
                        await horario.save();
                    }
                }
            }

            return res.status(200).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head><meta charset="UTF-8"><title>Pago Rechazado</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #c0392b;">Pago Rechazado ❌</h1>
                    <p>No se pudo autorizar la transacción para el pedido <strong>#${numeroPedido}</strong>.</p>
                </body>
                </html>
            `);
        }

    } catch (error) {
        console.error("Error crítico en confirmación de pago:", error);
        return res.status(500).send("Error interno al procesar el pago.");
    }
});

// Rutas de prueba para el bot con validación de parámetros
app.get("/api/bot/prueba-cantidad", (req, res) => {
    const texto = req.query.texto || "";
    const cantidad = detectarCantidad(texto);

    res.json({
        texto: texto,
        cantidad: cantidad
    });
});

app.post("/api/bot/prueba-productos", async (req, res) => {
    try {
        const { texto } = req.body;
        const productosDisponibles = await Producto.find({ activo: true });
        const productos = detectarProductos(texto, productosDisponibles); // ✅
        res.json({ productos });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/bot/prueba-buscar-producto", async (req, res) => {
    const productoBuscado = req.query.producto || "";
    const producto = await buscarProducto(productoBuscado);

    if (!producto) {
        return res.json({
            producto: null
        });
    }

    res.json({
        id: producto._id,
        nombre: producto.nombre,
        precio: producto.precio,
        stock: producto.stock
    });
});

app.get("/api/bot/prueba-intencion", (req, res) => {
    const texto = (req.query.texto || "").toLowerCase().trim();
    const intencion = detectarIntencion(texto);

    res.json({
        texto: texto,
        intencion: intencion
    });
});

app.get("/api/bot/prueba-productos", (req, res) => {
    const texto = (req.query.texto || "").toLowerCase().trim();
    const productos = detectarProductos(texto);

    res.json({
        texto: texto,
        productos: productos
    });
});

app.get("/api/bot/prueba-catalogo", async (req, res) => {
    try {
        const catalogo = await obtenerCatalogo();

        res.json({
            productos: catalogo
        });

    } catch (error) {
        res.status(500).json({
            mensaje: "Error al obtener el catálogo",
            error: error.message
        });
    }
});

app.delete("/api/pedidos/limpiar", async (req, res) => {
    try {
        await Pedido.deleteMany({});
        res.json({ mensaje: "Todos los pedidos han sido eliminados de la base de datos" });
    } catch (error) {
        res.status(500).json({
            mensaje: "Error al eliminar pedidos",
            error: error.message
        });
    }
});