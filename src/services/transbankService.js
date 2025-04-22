const { POSAutoservicio } = require('transbank-pos-sdk');
const logger = require('../utils/logger');
const fs = require('fs');
const os = require('os');

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
      // Asegurar formato de ticket
      const ticket = ticketNumber.padEnd(20, '0').substring(0, 20);
      logger.info(`Enviando venta - Monto: ${amount}, Ticket: ${ticket}, Voucher: ${printVoucher}`);

      const response = await this.pos.sale(amount, ticket, {
        printOnPos: printVoucher
      });

      logger.info(`Venta exitosa - Operación: ${response.operationNumber}`);
      return response;
    } catch (error) {
      logger.error('Error durante la venta:', error);
      throw error;
    }
  }

  async sendRefundCommand(amount, originalOperationNumber) {
    try {
      const response = await this.pos.refund(amount, originalOperationNumber);
      logger.info(`Reversa exitosa - Operación: ${response.operationNumber}`);
      return response;
    } catch (error) {
      logger.error('Error durante la reversa:', error);
      throw error;
    }
  }

  async getLastTransaction() {
    try {
      const response = await this.pos.getLastSale();
      logger.info(`Última transacción obtenida - Operación: ${response.operationNumber}`);
      return response;
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
