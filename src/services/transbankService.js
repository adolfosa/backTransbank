const { POSAutoservicio } = require('transbank-pos-sdk');
const autoReconnectPOS = require('../utils/posReconnect');
const logger = require('../utils/logger');

class TransbankService {
  constructor() {
    this.pos = new POSAutoservicio();
    this.connectedPort = null;

    // Deshabilitar mensajes de debug e intermedios
    this.pos.setDebug(false);
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

  async enviarVenta(amount, ticketNumber) {
    try {
      // Si el POS no está conectado, intentar reconexión
      if (!this.deviceConnected) {
        logger.warn('POS desconectado al intentar enviar venta. Intentando reconexión previa...');
        const reconnected = await autoReconnectPOS();
        if (!reconnected) {
          throw new Error('No se pudo reconectar al POS');
        }
      }

      const ticket = ticketNumber.padEnd(20, '0').substring(0, 20);
      const response = await this.pos.sale(amount, ticket);
      logger.info(`Venta enviada - Operación: ${response.operationNumber}`);
      return response;
    } catch (error) {
      // Si hay mensaje pendiente
      const pending = error.message.includes('still waiting for a response');
      const timeout = error.message.includes('not been received');

      if (pending || timeout) {
        logger.warn('⚠️ Estado bloqueado por transacción anterior. Reiniciando conexión...');
        await this.closeConnection();
        await autoReconnectPOS(); // Forzar reconexión completa
      }

      logger.error('Error durante la venta:', error);
      throw error;
    }
  }  

  async enviarVentaReversa(amount, originalOperationNumber) {
    try {
      const ticket = originalOperationNumber.padEnd(20, '0').substring(0, 20);
      const response = await this.pos.refund(amount, ticket, false);
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
      let parsed = null;
  
      try {
        logger.info('RAW RESPONSE de getLastSale:', response.rawResponse);
        parsed = response.rawResponse ? parseResponse(response.rawResponse) : null;
      } catch (e) {
        logger.warn('No se pudo parsear la última transacción:', e.message);
      }
  
      const hasRawData = response.rawResponse && response.rawResponse.trim() !== '';
  
      return {
        success: true,
        message: parsed
          ? 'Última transacción obtenida y parseada correctamente'
          : (hasRawData ? 'Última transacción obtenida pero no pudo ser parseada' : 'No se obtuvo información de la última transacción'),
        data: {
          raw: response.rawResponse || null,
          parsed: parsed || null,
          approved: parsed?.responseCode === '00' || false,
          responseCode: parsed?.responseCode || 'UNKNOWN',
          operationNumber: parsed?.operationNumber || response.operationNumber || null,
          message: parsed?.responseMessage || (hasRawData ? 'Respuesta recibida sin parsear' : 'Sin datos de última venta'),
          type: parsed?.type || '0210',
          fields: parsed?.rawFields || {},
          hasRawData
        }
      };
  
    } catch (error) {
      logger.error('Error al obtener última transacción:', error);
      throw error;
    }
  }
  
  

  async sendCloseCommand(printReport = true) {
    try {
      const response = await this.pos.closeDay({ printOnPos: printReport }, false);
      logger.info('Cierre de terminal exitoso');
      return response;
    } catch (error) {
      logger.error('Error durante el cierre de terminal:', error);
      throw error;
    }
  }

  async loadKey() {
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
    if (this.connectedPort) {
      try {
        await this.pos.disconnect();
        logger.info('Conexión con POS cerrada correctamente');
      } catch (error) {
        logger.error('Error al cerrar conexión con POS:', error.message);
      } finally {
        this.connectedPort = null;
      }
    } else {
      logger.warn('No hay conexión activa que cerrar');
    }
  }
}

module.exports = new TransbankService();
