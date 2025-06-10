const transbankService = require('../services/transbankService');
const logger = require('./logger'); 

async function autoReconnectPOS() {
  const preferredPort = process.env.TBK_PORT_PATH;

  try {
    const port = await transbankService.connectToPort(preferredPort);
    logger.info(`✅ POS reconectado exitosamente en puerto preferido: ${port.path}`);
    return true;
  } catch (err) {
    logger.warn(`⚠️ Falló reconexión en puerto preferido (${preferredPort}): ${err.message}`);
  }

  try {
    const ports = await transbankService.listAvailablePorts();
    const acmPorts = ports.filter(p => p.path.includes('ACM'));

    for (const port of acmPorts) {
      try {
        const result = await transbankService.connectToPort(port.path);
        logger.info(`✅ POS reconectado exitosamente en puerto alternativo: ${port.path}`);
        return true;
      } catch (err) {
        logger.warn(`❌ No se pudo reconectar por ${port.path}: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error(`❌ Error listando puertos para reconexión: ${error.message}`);
  }

  return false;
}

module.exports = autoReconnectPOS;
