const transbankService = require('../services/transbankService');
const responseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');

exports.processPayment = async (req, res) => {
  try {
    const { amount, ticketNumber, printVoucher = true, sendMessages = true } = req.body;
    
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
      printVoucher, 
      sendMessages
    );
    
    logger.info(`Transacción exitosa - Operación: ${result.operationNumber}`);
    responseHandler.success(res, 'Transacción exitosa', result);
  } catch (error) {
    logger.error(`Error en transacción: ${error.message}`, { stack: error.stack });
    responseHandler.error(res, error.message, 500, error.responseCode);
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
    responseHandler.error(res, error.message, 500, error.responseCode);
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

exports.initializeTerminal = async (req, res) => {
  try {
    logger.info('Iniciando inicialización de terminal');
    const result = await transbankService.initializeTerminal();
    
    logger.info('Terminal inicializado exitosamente');
    responseHandler.success(res, 'Terminal inicializado', result);
  } catch (error) {
    logger.error(`Error inicializando terminal: ${error.message}`, { stack: error.stack });
    responseHandler.error(res, error.message, 500);
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
    responseHandler.error(res, error.message, 500, error.responseCode);
  }
};