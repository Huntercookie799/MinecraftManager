#!/usr/bin/env bash
set -e

# Asegurar que el directorio del servidor existe
mkdir -p /minecraft/server
mkdir -p /minecraft/backups

# Descargar Paper si no existe
if [ ! -f /minecraft/server/paper.jar ]; then
  echo "Descargando PaperMC..."
  # Usaremos las variables de entorno si están configuradas, si no usarán valores por defecto
  node /app/scripts/download-paper.mjs
else
  echo "PaperMC ya está descargado en /minecraft/server/paper.jar"
fi

# Aceptar EULA automáticamente
echo "Aceptando EULA..."
echo "eula=true" > /minecraft/server/eula.txt

# Iniciar Playit.gg en segundo plano, guardando su clave secreta en el disco persistente
echo "Iniciando Playit.gg..."
cd /minecraft && playit --secret-path /minecraft/playit_secret.toml &
PLAYIT_PID=$!

# Volver al directorio de la app y arrancar Node
echo "Actualizando esquema de Base de Datos..."
cd /app
npx --yes prisma db push --skip-generate

echo "Iniciando Backend Node.js..."
node dist/server.js

# Si Node.js se detiene, matar playit
kill $PLAYIT_PID
