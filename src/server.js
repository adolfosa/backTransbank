require('dotenv').config();
const app = require('./app');
const logger = require('./utils/logger');
const transbankService = require('./services/transbankService');

const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

async function startServer() {
  try {
    logger.info(`Iniciando servidor en modo ${ENV}`);

    // Conexión automática con el POS (no bloqueante)
    transbankService.autoconnect()
      .then((port) => {
        if (port) {
          logger.info(`Conexión establecida con POS en ${port.path}`);
          logger.info(`Commerce Code: ${process.env.TBK_COMMERCE_CODE}`);
          logger.info(`Terminal ID: ${process.env.TBK_TERMINAL_ID}`);
        } else {
          logger.error('No se pudo conectar con ningún POS disponible');
        }
      })
      .catch(error => {
        logger.error('Error en conexión automática con POS:', error);
      });

    // Iniciar servidor HTTP
    const server = app.listen(PORT, () => {
      logger.info(`Servidor Transbank POS escuchando en puerto ${PORT}`);
    });

    app.get('/api/terminal/ports', async (req, res) => {
      try {
        const ports = await transbankService.listAvailablePorts();

        res.status(200).json({
          status: 'success',
          ports: ports.map(port => ({
            ...port,
            isCurrent: transbankService.connection?.path === port.path,
            recommended: port.manufacturer?.includes('Pax') || port.path.includes('ACM')
          })),
          baudRate: process.env.TBK_BAUD_RATE
        });
      } catch (error) {
        logger.error('Error al listar puertos:', error);
        res.status(500).json({
          status: 'error',
          message: 'No se pudieron listar los puertos',
          code: 'PORTS_LIST_ERROR'
        });
      }
    });

    app.post('/api/terminal/reconnect', async (req, res) => {
      try {
        const port = await transbankService.autoconnect();
        if (port) {
          res.status(200).json({
            status: 'success',
            message: `Conectado a POS en ${port.path}`,
            port: port.path
          });
        } else {
          res.status(503).json({
            status: 'error',
            message: 'No se encontró ningún POS conectado'
          });
        }
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error.message
        });
      }
    });

    app.get('/api/terminal/status', (req, res) => {
      res.status(200).json({
        status: 'success',
        connected: transbankService.deviceConnected,
        port: transbankService.connection?.path,
        message: transbankService.deviceConnected ?
          'POS operativo' : 'POS desconectado'
      });
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`Recibida señal ${signal}. Cerrando servidor...`);

      try {
        await Promise.race([
          new Promise(resolve => server.close(resolve)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cerrando servidor')), 5000)
        )]);

        logger.info('Servidor HTTP cerrado');

        await transbankService.closeConnection();
        logger.info('Conexiones cerradas correctamente');
      } catch (error) {
        logger.error('Error durante el shutdown:', error);
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      if (error.message.includes('POS') || error.message.includes('serialport')) {
        transbankService.closeConnection();
      }
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection:', {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined
      });
      gracefulShutdown('unhandledRejection');
    });

  } catch (error) {
    logger.error('Error crítico al iniciar el servidor:', error);
    process.exit(1);
  }
}

startServer();
