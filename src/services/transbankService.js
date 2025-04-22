const { POSAutoservicio } = require('transbank-pos-sdk');
const logger = require('../utils/logger');
const fs = require('fs');
const os = require('os');
const { parseResponse, constants } = require('../utils/posUtils');
const config = require('../config/transbankConfig');

const isAndroid = os.platform() === 'android';

function getAndroidSerialPorts() {
  return fs.readdirSync('/dev')
    .filter(name =>
      name.startsWith('ttyUSB') ||
      name.startsWith('ttyACM') ||
      name.startsWith('ttyS') ||
      name.startsWith('ttyFIQ') ||
      name.startsWith('ttySMT')
    )
    .map(name => `/dev/${name}`);
}

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

      if (isAndroid) {
        const candidates = getAndroidSerialPorts();

        for (const path of candidates) {
          try {
            logger.info(`Intentando conectar a ${path} @115200`);
            await this.pos.connect(path);
            this.connectedPort = { path };
            logger.info(`Conectado manualmente en Android al puerto ${path}`);
            return this.connectedPort;
          } catch (err) {
            logger.warn(`Fallo en ${path}: ${err.message}`);
          }
        }

        throw new Error('No se pudo conectar a ningún puerto disponible en Android');
      }

      const port = await this.pos.autoconnect();
      if (!port) throw new Error('No se encontró ningún POS conectado');

      this.connectedPort = port;
      logger.info(`Conectado automáticamente al POS en ${port.path}`);
      return port;

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

      for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
          response = await this.pos.sale(amount, ticket, {
            printOnPos: printVoucher
          });

          if (response.rawResponse && response.rawResponse.charCodeAt(0) === constants.NAK) {
            logger.warn(`Intento ${attempt}: POS respondió con NAK. Reintentando...`);
            continue;
          }

          break; // ACK recibido o respuesta válida
        } catch (err) {
          lastError = err;
          logger.warn(`Intento ${attempt} fallido: ${err.message}`);
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
        ...response,
        parsed
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

          if (response.rawResponse && response.rawResponse.charCodeAt(0) === constants.NAK) {
            logger.warn(`Intento ${attempt}: POS respondió con NAK en reversa. Reintentando...`);
            continue;
          }

          break;
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
        ...response,
        parsed
      };
    } catch (error) {
      if (error.message.includes('heap out of memory')) {
        this.memoryLimitReached = true;
        logger.fatal('Error crítico: memoria agotada. Se requiere reinicio del proceso.');
      }
      logger.error('Error durante la reversa:', error);
      throw error;
    }
  }

  async getLastTransaction() {
    try {
      if (this.memoryLimitReached) {
        throw new Error('El sistema detectó un problema de memoria. Reinicie el servicio.');
      }

      const response = await this.pos.getLastSale();
      logger.info(`Última transacción obtenida - Operación: ${response.operationNumber}`);
      return response;
    } catch (error) {
      if (error.message.includes('heap out of memory')) {
        this.memoryLimitReached = true;
        logger.fatal('Error crítico: memoria agotada. Se requiere reinicio del proceso.');
      }
      logger.error('Error al obtener última transacción:', error);
      throw error;
    }
  }

  async sendCloseCommand(printReport = true) {
    try {
      if (this.memoryLimitReached) {
        throw new Error('El sistema detectó un problema de memoria. Reinicie el servicio.');
      }

      const response = await this.pos.closeDay({ printOnPos: printReport });
      logger.info('Cierre de terminal exitoso');
      return response;
    } catch (error) {
      if (error.message.includes('heap out of memory')) {
        this.memoryLimitReached = true;
        logger.fatal('Error crítico: memoria agotada. Se requiere reinicio del proceso.');
      }
      logger.error('Error durante el cierre de terminal:', error);
      throw error;
    }
  }

  async initializeTerminal() {
    try {
      if (this.memoryLimitReached) {
        throw new Error('El sistema detectó un problema de memoria. Reinicie el servicio.');
      }

      await this.pos.loadKeys();
      logger.info('Inicialización del terminal completada (llaves cargadas)');
      return { success: true, message: 'Llaves cargadas correctamente' };
    } catch (error) {
      if (error.message.includes('heap out of memory')) {
        this.memoryLimitReached = true;
        logger.fatal('Error crítico: memoria agotada. Se requiere reinicio del proceso.');
      }
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
