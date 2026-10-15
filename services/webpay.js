const { WebpayPlus, Options, Environment, IntegrationCommerceCodes, IntegrationApiKeys } = require("transbank-sdk");

// Configurar credenciales (si no están en .env, usa las llaves públicas de prueba de Transbank)
const commerceCode = process.env.WEBPAY_COMMERCE_CODE || IntegrationCommerceCodes.WEBPAY_PLUS;
const apiKey = process.env.WEBPAY_API_KEY || IntegrationApiKeys.WEBPAY;
const environment = process.env.NODE_ENV === "production" 
    ? Environment.Production 
    : Environment.Integration;

// Instancia única de Transacción
const tx = new WebpayPlus.Transaction(
    new Options(commerceCode, apiKey, environment)
);

/**
 * Iniciar una transacción en Webpay Plus
 * @param {string} buyOrder - ID o número único de la orden
 * @param {string} sessionId - ID de sesión (ej: ID del carrito)
 * @param {number} amount - Monto total a cobrar
 * @param {string} returnUrl - URL de retorno donde Transbank responderá
 */
async function crearTransaccion(buyOrder, sessionId, amount, returnUrl) {
    try {
        const response = await tx.create(buyOrder, sessionId, amount, returnUrl);
        return response; // Devuelve { token, url }
    } catch (error) {
        console.error("Error al crear transacción Webpay:", error);
        throw error;
    }
}

/**
 * Confirmar/Validar el resultado del pago recibido desde Webpay
 * @param {string} token - Token devuelto por Transbank en el retorno
 */
async function confirmarTransaccion(token) {
    try {
        const response = await tx.commit(token);
        return response; // Devuelve el estado de la transacción
    } catch (error) {
        console.error("Error al confirmar transacción Webpay:", error);
        throw error;
    }
}

module.exports = {
    crearTransaccion,
    confirmarTransaccion
};