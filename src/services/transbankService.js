const { POSAutoservicio } = require('transbank-pos-sdk');
const logger = require('../utils/logger');

class TransbankService {
  constructor() {
    this.pos = new POSAutoservicio();
    this.connectedPort = null;

    this.pos.setDebug(true);    
  }

  async autoconnect() {
    try {
      // Si ya hay conexión activa, no intentamos reconectar
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
  
      // Priorizar ttyACM0
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
          continue;
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
      const response = await this.pos.sale(amount, ticketNumber, {
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
