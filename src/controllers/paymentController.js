const transbankService = require('../services/transbankService');
const responseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');

exports.processPayment = async (req, res) => {
  try {
    const { amount, ticketNumber, printVoucher = true } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      throw new Error('Monto inválido');
    }

    if (!ticketNumber || typeof ticketNumber !== 'string') {
      throw new Error('Número de ticket/boleta inválido');
    }

    logger.info(`Iniciando transacción - Monto: ${amount}, Ticket: ${ticketNumber}`);

    const result = await transbankService.sendSaleCommand(
      amount,
      ticketNumber,
      printVoucher
    );

    //result.responseMessage = result.responseMessage || 'Transacción exitosa';

    logger.info(`Conexión exitosa - Operación: ${result.operationNumber}`);
    responseHandler.success(res, result.message, {
      operationNumber: result.operationNumber,
      responseCode: result.responseCode,
      approved: result.approved,
      attempts: result.attempts,
      type: result.type,
      raw: result.raw,
      fields: result.fields
    });
    
    
  } catch (error) {
    if (error.message.includes('cancelada')) {
      logger.warn(`Transacción cancelada: ${error.message}`);
      responseHandler.error(res, 'Transacción cancelada por el usuario', 400, 'USER_CANCELLED');
    } else {
      logger.error(`Error en transacción: ${error.message}`, { stack: error.stack });
      responseHandler.error(res, error.message, 500, error.responseCode || 'UNKNOWN');
    }
  }
};

exports.processRefund = async (req, res) => {
  try {
    const { amount, originalOperationNumber } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      throw new Error('Monto inválido');
    }

    if (!originalOperationNumber) {
      throw new Error('Número de operación original requerido');
    }

    logger.info(`Iniciando reversa - Monto: ${amount}, Operación original: ${originalOperationNumber}`);

    const result = await transbankService.sendRefundCommand(amount, originalOperationNumber);

    logger.info(`Reversa exitosa - Operación: ${result.operationNumber}`);
    responseHandler.success(res, 'Reversa exitosa', result);
  } catch (error) {
    logger.error(`Error en reversa: ${error.message}`, { stack: error.stack });
    responseHandler.error(res, error.message, 500, error.responseCode || 'UNKNOWN');
  }
};

exports.getLastTransaction = async (req, res) => {
  try {
    logger.info('Solicitando última transacción');
    const result = await transbankService.getLastTransaction();

    if (!result) {
      return responseHandler.success(res, 'No se encontraron transacciones', {});
    }

    logger.info(`Última transacción obtenida - Operación: ${result.operationNumber}`);
    responseHandler.success(res, 'Última transacción obtenida', result);
  } catch (error) {
    logger.error(`Error obteniendo última transacción: ${error.message}`, { stack: error.stack });
    responseHandler.error(res, error.message, 500);
  }
};

exports.closeTerminal = async (req, res) => {
  try {
    const { printReport = true } = req.body;

    logger.info('Iniciando cierre de terminal');
    const result = await transbankService.sendCloseCommand(printReport);

    logger.info('Cierre de terminal completado exitosamente');
    responseHandler.success(res, 'Cierre de terminal exitoso', result);
  } catch (error) {
    logger.error(`Error en cierre de terminal: ${error.message}`, { stack: error.stack });
    responseHandler.error(res, error.message, 500, error.responseCode || 'UNKNOWN');
  }
};

exports.initializeTerminal = async (req, res) => {
  try {
    logger.info('Iniciando carga de llaves del terminal');
    const result = await transbankService.initializeTerminal();

    logger.info('Terminal inicializado exitosamente');
    responseHandler.success(res, 'Terminal inicializado', result);
  } catch (error) {
    logger.error(`Error inicializando terminal: ${error.message}`, { stack: error.stack });
    responseHandler.error(res, error.message, 500, error.responseCode || 'UNKNOWN');
  }
};
