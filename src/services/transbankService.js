const { POSAutoservicio } = require('transbank-pos-sdk');
const logger = require('../utils/logger');
const { parseResponse } = require('../utils/posUtils');
const { NAK } = require('../utils/posUtils').constants;
const config = require('../config/transbankConfig');

class TransbankService {
  constructor() {
    this.pos = new POSAutoservicio();
    this.connectedPort = null;
    this.memoryLimitReached = false;
    this.pos.setDebug(true);
  }

  async autoconnect() {
    try {
      if (this.pos.isConnected() && this.connectedPort) {
        logger.info(`POS ya conectado en ${this.connectedPort.path}`);
        return this.connectedPort;
      }

      const allPorts = await this.pos.listPorts();
      const validPorts = allPorts.filter(p =>
        p.path.toLowerCase().includes('acm') ||
        p.path.toLowerCase().includes('usb')
      );

      if (validPorts.length === 0) {
        throw new Error('No se encontró ningún POS conectado (puertos ACM o USB)');
      }

      validPorts.sort((a, b) => {
        if (a.path === '/dev/ttyACM0') return -1;
        if (b.path === '/dev/ttyACM0') return 1;
        return 0;
      });

      for (const port of validPorts) {
        try {
          await this.pos.connect(port.path);
          this.connectedPort = port;
          logger.info(`Conectado automáticamente al POS en ${port.path}`);
          return port;
        } catch (err) {
          logger.warn(`No se pudo conectar a ${port.path}: ${err.message}`);
        }
      }

      throw new Error('No fue posible establecer conexión con ninguno de los puertos detectados');
    } catch (error) {
      logger.error('Error en autoconnect():', error);
      this.connectedPort = null;
      throw error;
    }
  }

  async connectToPort(portPath) {
    const response = await this.pos.connect(portPath);
    this.connectedPort = { path: portPath, ...response };
    logger.info(`Conectado manualmente al puerto ${portPath}`);
    return response;
  }

  async listAvailablePorts() {
    const ports = await this.pos.listPorts();
    return ports.map(port => ({
      path: port.path,
      manufacturer: port.manufacturer || 'Desconocido'
    }));
  }

  async sendSaleCommand(amount, ticketNumber, printVoucher = true) {
    try {
      if (this.memoryLimitReached) {
        throw new Error('El sistema detectó un problema de memoria. Reinicie el servicio.');
      }
  
      const ticket = ticketNumber.padEnd(20, '0').substring(0, 20);
      logger.info(`Enviando venta - Monto: ${amount}, Ticket: ${ticket}, Voucher: ${printVoucher}`);
  
      let response = null;
      let lastError = null;
      let attempts = 0;
  
      for (attempts = 1; attempts <= config.maxRetries; attempts++) {
        try {
          response = await this.pos.sale(amount, ticket, {
            printOnPos: printVoucher
          });
  
          if (response.rawResponse && response.rawResponse.charCodeAt(0) === NAK) {
            logger.warn(`Intento ${attempts}: POS respondió con NAK. Reintentando...`);
            continue;
          }
  
          break; // ACK recibido o respuesta válida
        } catch (err) {
          lastError = err;
          logger.warn(`Intento ${attempts} fallido: ${err.message}`);
        }
      }
  
      if (!response) {
        throw lastError || new Error('Transacción fallida. No se recibió respuesta del POS.');
      }
  
      let parsed = null;
      try {
        parsed = response.rawResponse ? parseResponse(response.rawResponse) : null;
      } catch (e) {
        logger.warn('No se pudo parsear la respuesta del POS:', e.message);
      }
  
      logger.info(`Venta exitosa - Operación: ${parsed?.operationNumber || 'desconocida'}`);
  
      return {
        success: true,
        attempts,
        raw: response.rawResponse,
        parsed,
        approved: parsed?.responseCode === '00',
        responseCode: parsed?.responseCode || 'UNKNOWN',
        operationNumber: parsed?.operationNumber || null,
        message: parsed?.responseMessage || 'Transacción completada',
        type: parsed?.type || '0210', // 0210 es respuesta final
        fields: parsed?.rawFields || {}
      };
  
    } catch (error) {
      if (error.message.includes('JavaScript heap out of memory')) {
        this.memoryLimitReached = true;
        logger.fatal('Error crítico: memoria agotada. Requiere reinicio del proceso.');
      }
      logger.error('Error durante la venta:', error);
      throw error;
    }
  }
  

  async sendRefundCommand(amount, originalOperationNumber) {
    try {
      if (this.memoryLimitReached) {
        throw new Error('El sistema detectó un problema de memoria. Reinicie el servicio.');
      }
  
      let response = null;
      let lastError = null;
  
      for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
          response = await this.pos.refund(amount, originalOperationNumber);
  
          if (response.rawResponse && response.rawResponse.charCodeAt(0) === NAK) {
            logger.warn(`Intento ${attempt}: POS respondió con NAK en reversa. Reintentando...`);
            continue;
          }
  
          break; // respuesta válida
        } catch (err) {
          lastError = err;
          logger.warn(`Intento ${attempt} fallido al revertir: ${err.message}`);
        }
      }
  
      if (!response) {
        throw lastError || new Error('Reversa fallida. No se recibió respuesta del POS.');
      }
  
      let parsed = null;
      try {
        parsed = response.rawResponse ? parseResponse(response.rawResponse) : null;
      } catch (e) {
        logger.warn('No se pudo parsear la respuesta del POS en reversa:', e.message);
      }
  
      logger.info(`Reversa exitosa - Operación: ${parsed?.operationNumber || 'desconocida'}`);
  
      return {
        success: true,
        attempts,
        raw: response.rawResponse,
        parsed,
        approved: parsed?.responseCode === '00',
        responseCode: parsed?.responseCode || 'UNKNOWN',
        operationNumber: parsed?.operationNumber || null,
        message: parsed?.responseMessage || 'Reversa completada',
        type: parsed?.type || '0210',
        fields: parsed?.rawFields || {}
      };
      
    } catch (error) {
      if (error.message.includes('JavaScript heap out of memory')) {
        this.memoryLimitReached = true;
        logger.fatal('Error crítico: memoria agotada. Requiere reinicio del proceso.');
      }
      logger.error('Error durante la reversa:', error);
      throw error;
    }
  }
  

  async getLastTransaction() {
    try {
      const response = await this.pos.getLastSale();
      logger.info(`Última transacción obtenida - Operación: ${response.operationNumber}`);
      let parsed = null;
    try {
      parsed = response.rawResponse ? parseResponse(response.rawResponse) : null;
    } catch (e) {
      logger.warn('No se pudo parsear la última transacción:', e.message);
    }

    return {
      success: true,
      raw: response.rawResponse,
      parsed,
      approved: parsed?.responseCode === '00',
      responseCode: parsed?.responseCode || 'UNKNOWN',
      operationNumber: parsed?.operationNumber || null,
      message: parsed?.responseMessage || 'Última transacción',
      type: parsed?.type || '0210',
      fields: parsed?.rawFields || {}
    };

    } catch (error) {
      logger.error('Error al obtener última transacción:', error);
      throw error;
    }
  }

  async sendCloseCommand(printReport = true) {
    try {
      const response = await this.pos.closeDay({ printOnPos: printReport });
      logger.info('Cierre de terminal exitoso');
      return response;
    } catch (error) {
      logger.error('Error durante el cierre de terminal:', error);
      throw error;
    }
  }

  async initializeTerminal() {
    try {
      await this.pos.loadKeys();
      logger.info('Inicialización del terminal completada (llaves cargadas)');
      return { success: true, message: 'Llaves cargadas correctamente' };
    } catch (error) {
      logger.error('Error al inicializar terminal (cargar llaves):', error);
      throw error;
    }
  }

  get deviceConnected() {
    return this.connectedPort !== null;
  }

  get connection() {
    return this.connectedPort;
  }

  async closeConnection() {
    try {
      await this.pos.disconnect();
      logger.info('Conexión con POS cerrada');
      this.connectedPort = null;
    } catch (error) {
      logger.error('Error al cerrar conexión con POS:', error);
    }
  }
}

module.exports = new TransbankService();
