#!/bin/bash
sleep 5  # Espera 5 segundos para asegurar que otros servicios estén listos
node /home/token1/Escritorio/backTransbank/src/server.js

 export PATH=$PATH:/usr/bin:/usr/local/bin

# # Navegar al directorio de la aplicación (opcional pero recomendado)
cd /home/token1/Escritorio/backTransbank/src

# # Iniciar la aplicación con logging
echo "[$(date)] Iniciando servidor backTransbank..." >> /home/token1/server.log
node server.js >> /home/token1/server.log 2>&1