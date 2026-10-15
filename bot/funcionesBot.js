const Producto = require("../models/Producto");

// ================================================================
// DETECTAR CANTIDAD GENERAL
// ================================================================

function detectarCantidad(texto) {
    let cantidad = 1;
    const numeroEncontrado = texto.match(/\d+/);

    if (numeroEncontrado) {
        cantidad = parseInt(numeroEncontrado[0]);
    } else {
        const cantidades = {
            "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4,
            "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10
        };

        for (const palabra in cantidades) {
            if (texto.includes(palabra)) {
                cantidad = cantidades[palabra];
                break;
            }
        }
    }

    return cantidad;
}

// ================================================================
// DETECTAR PRODUCTO INDIVIDUAL (FALLBACK)
// ================================================================

function detectarProducto(texto, productosDisponibles = []) {
    const textoL = texto.toLowerCase();

    for (const prod of productosDisponibles) {
        const nombreProd = prod.nombre.toLowerCase();
        if (textoL.includes(nombreProd)) {
            return nombreProd;
        }
    }

    if (textoL.includes("pino")) return "pino";
    if (textoL.includes("queso")) return "queso";

    return null;
}

// ================================================================
// BUSCAR Y OBTENER CATÁLOGO EN MONGODB
// ================================================================

async function buscarProducto(productoBuscado) {
    const producto = await Producto.findOne({
        nombre: {
            $regex: productoBuscado,$options: "i"
        },
        activo: true
    });

    return producto;
}

async function obtenerCatalogo() {
    const productos = await Producto.find({
        activo: true,
        stock: { $gt: 0 }
    });

    return productos.map(producto => ({
        id: producto._id,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        precio: producto.precio,
        stockDisponible: producto.stock,
        stock: producto.stock,
        _id: producto._id
    }));
}

// ================================================================
// CALCULAR TOTAL DEL CARRITO
// ================================================================

function calcularTotalCarrito(carrito) {
    let total = 0;
    for (const item of carrito.productos) {
        total += item.precioUnitario * item.cantidad;
    }
    return total;
}

// ================================================================
// AGREGAR PRODUCTO AL CARRITO
// ================================================================

async function agregarProductoAlCarrito(carrito, producto, cantidad) {
    const productoExistente = carrito.productos.find(
        item => item.productoId.toString() === producto._id.toString()
    );

    const cantidadActual = productoExistente ? productoExistente.cantidad : 0;
    const cantidadFinal = cantidadActual + cantidad;

    if (cantidadFinal > producto.stock) {
        return {
            ok: false,
            mensaje: `No hay suficiente stock de ${producto.nombre}.`,
            stockDisponible: producto.stock,
            cantidadEnCarrito: cantidadActual
        };
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

    carrito.total = calcularTotalCarrito(carrito);
    await carrito.save();

    return {
        ok: true,
        mensaje: `Agregué ${cantidad} ${producto.nombre} a tu carrito. Tu total es $${carrito.total}.`,
        carrito: carrito
    };
}

// ================================================================
// VALIDAR STOCK DE VARIOS PRODUCTOS
// ================================================================

async function validarStockProductos(carrito, productosDetectados, productosDisponibles) {
    const productosValidados = [];

    for (const item of productosDetectados) {
        const producto = productosDisponibles
            ? productosDisponibles.find(p => p.nombre.toLowerCase().includes(item.producto.toLowerCase()))
            : await buscarProducto(item.producto);

        if (!producto) {
            return {
                ok: false,
                mensaje: `El producto ${item.producto} no está disponible.`
            };
        }

        const productoExistente = carrito.productos.find(
            p => p.productoId.toString() === producto._id.toString()
        );

        const cantidadActual = productoExistente ? productoExistente.cantidad : 0;
        const cantidadFinal = cantidadActual + item.cantidad;

        if (cantidadFinal > producto.stock) {
            return {
                ok: false,
                mensaje: `No hay suficiente stock de ${producto.nombre}.`,
                stockDisponible: producto.stock,
                cantidadEnCarrito: cantidadActual,
                cantidadSolicitada: item.cantidad
            };
        }

        productosValidados.push({
            producto: producto,
            cantidad: item.cantidad
        });
    }

    return {
        ok: true,
        productos: productosValidados
    };
}

// ================================================================
// QUITAR PRODUCTO DEL CARRITO
// ================================================================

async function quitarProductoDelCarrito(carrito, productoBuscado, cantidad) {
    const productoExistente = carrito.productos.find(
        item => item.nombre.toLowerCase().includes(productoBuscado.toLowerCase())
    );

    if (!productoExistente) {
        return {
            ok: false,
            mensaje: `No tienes ${productoBuscado} en tu carrito.`
        };
    }

    if (cantidad > productoExistente.cantidad) {
        return {
            ok: false,
            mensaje: `Solo tienes ${productoExistente.cantidad} ${productoExistente.nombre} en tu carrito.`
        };
    }

    productoExistente.cantidad -= cantidad;

    if (productoExistente.cantidad === 0) {
        carrito.productos = carrito.productos.filter(
            item => item.productoId.toString() !== productoExistente.productoId.toString()
        );
    }

    carrito.total = calcularTotalCarrito(carrito);
    await carrito.save();

    return {
        ok: true,
        mensaje: `Quité ${cantidad} ${productoExistente.nombre} de tu carrito. Tu total es $${carrito.total}.`,
        carrito: carrito
    };
}

// ================================================================
// DETECTAR INTENCIÓN
// ================================================================

function detectarIntencion(texto) {
    if (texto === "hola") return "saludo";

    if (
        texto.includes("qué tienen") || texto.includes("que tienen") ||
        texto.includes("qué hay") || texto.includes("que hay") ||
        texto.includes("qué empanadas") || texto.includes("que empanadas") ||
        texto.includes("menú") || texto.includes("menu") ||
        texto.includes("catálogo") || texto.includes("catalogo")
    ) {
        return "consultar_catalogo";
    }

    if (
        texto.includes("qué llevo") || texto.includes("que llevo") ||
        texto.includes("cuánto llevo") || texto.includes("cuanto llevo") ||
        texto.includes("mi carrito") || texto.includes("ver carrito")
    ) {
        return "consultar_carrito";
    }

    if (
        texto.includes("retiro") || texto.includes("retirar") ||
        texto.includes("pasar a buscar")
    ) {
        return "seleccionar_retiro";
    }

    if (
        texto.includes("delivery") || texto.includes("domicilio") ||
        texto.includes("envío") || texto.includes("envio") ||
        texto.includes("enviar")
    ) {
        return "seleccionar_delivery";
    }

    if (
        texto.includes("quita") || texto.includes("quitar") ||
        texto.includes("elimina") || texto.includes("eliminar") ||
        texto.includes("saca") || texto.includes("sacar")
    ) {
        return "quitar_producto";
    }

    if (
        texto.includes("mi dirección") || texto.includes("mi direccion") ||
        texto.includes("la dirección") || texto.includes("la direccion") ||
        texto.includes("entregar en") || texto.includes("envíen a") ||
        texto.includes("envien a")
    ) {
        return "ingresar_direccion";
    }

    if (
        texto.includes("hoy") || texto.includes("mañana") ||
        texto.includes("manana") || texto.includes("pasado mañana") ||
        texto.includes("pasado manana")
    ) {
        return "seleccionar_fecha";
    }

    if (
        texto.includes("efectivo") || texto.includes("transferencia") ||
        texto.includes("transferir") || texto.includes("tarjeta") ||
        texto.includes("débito") || texto.includes("debito") ||
        texto.includes("crédito") || texto.includes("credito") ||
        texto.includes("webpay") || texto.includes("pagar") ||
        texto.includes("pago")
    ) {
        return "seleccionar_pago";
    }

    if (
        texto === "si" || texto === "sí" || texto === "confirmo" ||
        texto === "confirmar" || texto === "no" || texto === "cancelar"
    ) {
        return "confirmacion";
    }

    if (
        texto.includes("quiero") || texto.includes("dame") ||
        texto.includes("agrega") || texto.includes("agregar") ||
        texto.includes("añade") || texto.includes("añadir")
    ) {
        return "agregar_producto";
    }

    return "desconocida";
}

// ================================================================
// DETECTAR PRODUCTOS Y CANTIDADES (MEJORADO Y FLEXIBLE)
// ================================================================

function detectarCantidadProducto(texto, palabraClave) {
    const cantidades = {
        "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4,
        "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10
    };

    // 1. Patrón: "2 de pino", "2 pino", "2 empanadas de pino"
    const regexNumero = new RegExp(`(\\d+)\\s*(?:empanadas?|unidades?|de)?\\s*${palabraClave}`, "i");
    const matchNumero = texto.match(regexNumero);
    if (matchNumero) {
        return parseInt(matchNumero[1]);
    }

    // 2. Patrón con palabras: "dos de pino", "tres pino"
    for (const [palabra, valor] of Object.entries(cantidades)) {
        const regexPalabra = new RegExp(`\\b${palabra}\\b\\s*(?:empanadas?|unidades?|de)?\\s*${palabraClave}`, "i");
        if (regexPalabra.test(texto)) {
            return valor;
        }
    }

    // 3. Fallback: Si hay un número en el texto pero no pegado al nombre
    const numeroGeneral = texto.match(/\d+/);
    if (numeroGeneral) {
        return parseInt(numeroGeneral[0]);
    }

    return 1;
}

function detectarProductos(texto, productosDisponibles = []) {
    const productosDetectados = [];
    const textoL = texto.toLowerCase();

    for (const prod of productosDisponibles) {
        const nombreProd = prod.nombre.toLowerCase();

        // Extraer palabras clave del nombre (ej: "Empanada de Pino" -> "pino")
        const palabrasClave = nombreProd
            .split(" ")
            .filter(p => p.length > 2 && !["empanada", "empanadas", "del", "con", "para", "de"].includes(p));

        const palabraCoincidida = palabrasClave.find(p => textoL.includes(p)) || (textoL.includes(nombreProd) ? nombreProd : null);

        if (palabraCoincidida) {
            const cantidad = detectarCantidadProducto(textoL, palabraCoincidida);
            productosDetectados.push({
                producto: prod.nombre,
                cantidad: cantidad
            });
        }
    }

    return productosDetectados;
}

function detectarDireccion(texto) {
    const patrones = [
        "mi dirección es", "mi direccion es", "la dirección es",
        "la direccion es", "dirección:", "direccion:",
        "entregar en", "envíen a", "envien a"
    ];

    for (const patron of patrones) {
        const posicion = texto.indexOf(patron);
        if (posicion !== -1) {
            const direccion = texto.substring(posicion + patron.length).trim();
            if (direccion.length > 0) return direccion;
        }
    }

    return null;
}

function detectarFecha(texto) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    if (texto.includes("pasado mañana") || texto.includes("pasado manana")) {
        const fecha = new Date(hoy);
        fecha.setDate(fecha.getDate() + 2);
        return fecha;
    }

    if (texto.includes("mañana") || texto.includes("manana")) {
        const fecha = new Date(hoy);
        fecha.setDate(fecha.getDate() + 1);
        return fecha;
    }

    if (texto.includes("hoy")) {
        return hoy;
    }

    return null;
}

function detectarHora(texto) {
    const horaConMinutos = texto.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (horaConMinutos) {
        return `${horaConMinutos[1].padStart(2, "0")}:${horaConMinutos[2]}`;
    }

    const horaExplicita = texto.match(/\b(?:a las|a la|son las)\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:horas|hrs|h)\b/i);
    if (horaExplicita) {
        const horaNum = Number(horaExplicita[1] || horaExplicita[2]);
        if (horaNum >= 0 && horaNum <= 23) {
            return `${String(horaNum).padStart(2, "0")}:00`;
        }
    }

    return null;
}

function detectarMetodoPago(texto) {
    if (texto.includes("efectivo") || texto.includes("cash")) return "efectivo";
    if (texto.includes("transferencia") || texto.includes("transferir")) return "transferencia";
    if (
        texto.includes("webpay") || texto.includes("tarjeta") ||
        texto.includes("débito") || texto.includes("debito") ||
        texto.includes("crédito") || texto.includes("credito")
    ) {
        return "webpay";
    }

    return null;
}

function detectarConfirmacion(texto) {
    if (
        texto === "si" || texto === "sí" || texto === "confirmo" ||
        texto === "confirmar" || texto === "confirmado" ||
        texto.includes("si confirmo") || texto.includes("sí confirmo")
    ) {
        return true;
    }

    if (
        texto === "no" || texto === "cancelar" ||
        texto === "cancela" || texto === "cancelado"
    ) {
        return false;
    }

    return null;
}

module.exports = {
    detectarCantidad,
    detectarProducto,
    detectarProductos,
    detectarCantidadProducto,
    buscarProducto,
    obtenerCatalogo,
    calcularTotalCarrito,
    agregarProductoAlCarrito,
    quitarProductoDelCarrito,
    detectarIntencion,
    validarStockProductos,
    detectarDireccion,
    detectarFecha,
    detectarHora,
    detectarMetodoPago,
    detectarConfirmacion
};