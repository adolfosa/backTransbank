const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const path = require('path');

function imprimirTicket({ Codigo, hora, fecha, tipo, qrBase64 }) {
  return new Promise((resolve, reject) => {
    if (!Codigo || !tipo) {
      return reject(new Error('Campos requeridos faltantes'));
    }

    const content = `
    Ticket de Acceso
    -------------------------
    Fecha: ${fecha}
    Hora: ${hora}
    Tipo: ${tipo}
    Código: ${Codigo}
    `;

    const bufferTexto = Buffer.from(content, 'ascii');    
    const bufferFinal = Buffer.concat([bufferTexto]);

    const tmpDir = os.tmpdir();
    const textPath = path.join(tmpDir, 'ticket_text.bin');
    const imagePath = path.join(tmpDir, 'qr_image.png');

    try {
      fs.writeFileSync(textPath, bufferFinal);

      if (qrBase64) {
        const imageBuffer = Buffer.from(qrBase64, 'base64');
        fs.writeFileSync(imagePath, imageBuffer);

        // Comando para imprimir texto + imagen (necesita que LPT1 lo acepte o usar herramientas como RawBT, etc.)
        exec(`type "${textPath}" > LPT1 && mspaint /pt "${imagePath}"`, (err) => {
          if (err) {
            return reject(new Error('Error al imprimir: ' + err.message));
          }
          resolve('Ticket impreso con QR.');
        });
      } else {
        exec(`type "${textPath}" > LPT1`, (err) => {
          if (err) {
            return reject(new Error('Error al imprimir texto: ' + err.message));
          }
          resolve('Ticket impreso sin QR.');
        });
      }
    } catch (err) {
      reject(new Error('Fallo al preparar impresión: ' + err.message));
    }
  });
}

module.exports = { imprimirTicket };
