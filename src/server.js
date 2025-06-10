require('dotenv').config();
const app = require('./app');
const transbankService = require('./services/transbankService');
const terminalController = require('./controllers/terminalController');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';
const MAX_RETRIES = process.env.TBK_CONNECTION_RETRIES || 10;
const RETRY_DELAY = process.env.TBK_RETRY_DELAY_MS || 5000;

async function connectToPOS() {
  let attempt = 0;
  let connected = false;

  while (attempt < MAX_RETRIES && !connected) {
    try {
      attempt++;
      console.log(`Intento ${attempt} de conexión al POS...`);

      await transbankService.closeConnection().catch(() => {});

      const preferredPort = process.env.TBK_PORT_PATH;
      try {
        await transbankService.connectToPort(preferredPort);
        console.log(`POS conectado a puerto preferido: ${preferredPort}`);
        connected = true;      
      } catch (initialError) {
        console.warn(`No se pudo conectar a puerto preferido (${preferredPort}): ${initialError.message}`);
        
        const allPorts = await transbankService.listAvailablePorts();
        const acmPorts = allPorts.filter(p => p.path.includes('ACM'));

        for (const port of acmPorts) {
          if (port.path === preferredPort) continue;
          try {
            await transbankService.connectToPort(port.path);
            console.log(`POS conectado a puerto alternativo: ${port.path}`);
            connected = true;
            break;
          } catch (err) {
            console.warn(`Falló conexión a ${port.path}: ${err.message}`);
          }
        }
      }

      if (connected) {     
        await transbankService.loadKey();
        console.log('🔐 Llaves cargadas exitosamente');
        await terminalController.startPOSMonitor();
        return true;
      }

      if (attempt < MAX_RETRIES) {
        console.log(`Reintentando en ${RETRY_DELAY/1000} segundos...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    } catch (error) {
      console.error(`Error en intento ${attempt}: ${error.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  if (!connected) {
    console.error(`❌ No se pudo conectar a ningún puerto POS después de ${MAX_RETRIES} intentos`);
    return false;
  }
}

async function startServer() {
  try {
    console.log(`Iniciando servidor en modo ${ENV}`);

    const sslOptions = {
      key: fs.readFileSync(path.resolve(__dirname, '../ssl/key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, '../ssl/cert.pem'))
    };

    const server = https.createServer(sslOptions, app).listen(PORT, async () => {
      console.log(`Servidor Transbank POS con SSL escuchando en https://localhost:${PORT}`);
      await connectToPOS();
    });

    const gracefulShutdown = async (signal) => {
      console.log(`Recibida señal ${signal}. Cerrando servidor...`);
      try {
        await Promise.race([
          new Promise(resolve => server.close(resolve)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout cerrando servidor')), 5000))
        ]);
        console.log('Servidor HTTPS cerrado');
        await transbankService.closeConnection();
        console.log('Conexión con POS cerrada correctamente');
      } catch (error) {
        console.error('Error durante el shutdown:', error.message);
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      if (error.message.includes('POS') || error.message.includes('serialport')) {
        transbankService.closeConnection();
      }
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });

  } catch (fatalError) {
    console.error('Error crítico al iniciar el servidor:', fatalError.message);
    process.exit(1);
  }
}

startServer();