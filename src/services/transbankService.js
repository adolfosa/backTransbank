const { POSAutoservicio } = require('transbank-pos-sdk');
const autoReconnectPOS = require('../utils/posReconnect');

class TransbankService {
  constructor() {
    this.pos = new POSAutoservicio();
    this.connectedPort = null;

    this.pos.setDebug(false);
  }

  async connectToPort(portPath) {
    const response = await this.pos.connect(portPath);
    this.connectedPort = { path: portPath, ...response };
    console.log(`Conectado manualmente al puerto ${portPath}`);
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
      if (!this.deviceConnected) {
        console.warn('POS desconectado al intentar enviar venta. Intentando reconexión previa...');
        const reconnected = await autoReconnectPOS();
        if (!reconnected) {
          throw new Error('No se pudo reconectar al POS');
        }
      }

      const ticket = ticketNumber.padEnd(20, '0').substring(0, 20);
      const response = await this.pos.sale(amount, ticket);
      console.log(`Venta enviada - Operación: ${response.operationNumber}`);
      return response;
    } catch (error) {
      const pending = error.message.includes('still waiting for a response');
      const timeout = error.message.includes('not been received');

      if (pending || timeout) {
        console.warn('⚠️ Estado bloqueado por transacción anterior. Reiniciando conexión...');
        await this.closeConnection();
        await autoReconnectPOS();
      }

      console.error('Error durante la venta:', error);
      throw error;
    }
  }

  async enviarVentaReversa(amount, originalOperationNumber) {
    try {
      const ticket = originalOperationNumber.padEnd(20, '0').substring(0, 20);
      const response = await this.pos.refund(amount, ticket, false);
      console.log(`Reversa exitosa - Operación: ${response.operationNumber}`);
      return response;
    } catch (error) {
      console.error('Error durante la reversa:', error);
      throw error;
    }
  }

  async getLastTransaction() {
    try {
      const response = await this.pos.getLastSale();
      console.debug('Respuesta completa del POS:', JSON.stringify(response, null, 2));

      return {
        success: true,
        message: 'Transacción obtenida correctamente',
        data: {
          approved: response.successful,
          responseCode: response.responseCode === 0 ? '00' : 'UNKNOWN',
          operationNumber: response.operationNumber,
          amount: response.amount,
          cardNumber: response.last4Digits ? `••••${response.last4Digits}` : null,
          authorizationCode: response.authorizationCode,
          timestamp: response.realDate && response.realTime
            ? `${response.realDate} ${response.realTime}`
            : null,
          cardType: response.cardType,
          cardBrand: response.cardBrand,
          rawData: response
        }
      };
    } catch (error) {
      console.error('Error al obtener última transacción:', error);
      throw error;
    }
  }

  async sendCloseCommand(printReport = true) {
    try {
      const response = await this.pos.closeDay({ printOnPos: printReport }, false);
      console.log('Cierre de terminal exitoso');
      return response;
    } catch (error) {
      console.error('Error durante el cierre de terminal:', error);
      throw error;
    }
  }

  async loadKey() {
    try {
      await this.pos.loadKeys();
      console.log('Inicialización del terminal completada (llaves cargadas)');
      return { success: true, message: 'Llaves cargadas correctamente' };
    } catch (error) {
      console.error('Error al inicializar terminal (cargar llaves):', error);
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
        console.log('Conexión con POS cerrada correctamente');
      } catch (error) {
        console.error('Error al cerrar conexión con POS:', error.message);
      } finally {
        this.connectedPort = null;
      }
    } else {
      console.warn('No hay conexión activa que cerrar');
    }
  }
}

module.exports = new TransbankService();
