# 🎮 Minecraft Manager - Cloud Edition

Una aplicación web completa para administrar tu propio servidor de Minecraft (Paper/Purpur) de manera **100% gratuita** utilizando el nivel gratuito de Render, apoyado por TiDB para la base de datos de usuarios y Cloudflare R2 para almacenamiento persistente de mundos.

![Minecraft Manager Panel](/backend/public/thumbnails/default.jpg)

## 🌟 Características Principales

- **Panel Web Interactivo:** Enciende, reinicia y apaga tu servidor desde un entorno visual moderno.
- **Consola en Vivo:** Visualiza y envía comandos (`/say`, `/op`, `/time set`) en tiempo real vía WebSockets.
- **Persistencia en la Nube (S3):** Dado que Render borra los archivos cada vez que se reinicia, este proyecto comprime automáticamente tu mundo y lo sube a **Cloudflare R2** al apagar el servidor. Al encenderlo, lo descarga y lo restaura.
- **Soporte de Plantillas (`template.zip`):** Permite saltarse la lenta generación de mundos inicial descargando un entorno pre-cargado.
- **Sistema de Usuarios y Auth:** Registros seguros usando Prisma + MySQL (TiDB).
- **Túneles TCP (Playit.gg):** Solución integrada para exponer puertos de juego cuando el hosting solo admite HTTP/HTTPS.

---

## 🚀 Guía de Instalación desde Cero (Producción)

Sigue estos 3 pasos para montar tu servidor gratis en la nube:

### 1. Base de Datos (TiDB Serverless)
1. Ve a [TiDB Cloud](https://tidbcloud.com/) y crea un clúster **Serverless** (gratuito).
2. Selecciona **MySQL** como motor.
3. Genera una contraseña y haz clic en **Connect**.
4. Copia tu Cadena de Conexión (Connection String), que se verá similar a:
   `mysql://<user>:<password>@gateway01.us-west-2.prod.aws.tidbcloud.com:4000/minecraft_proyect_pro?sslaccept=strict`

### 2. Almacenamiento S3 (Cloudflare R2)
1. Crea una cuenta en [Cloudflare](https://dash.cloudflare.com/) y dirígete a **R2 Object Storage**.
2. Crea un nuevo bucket llamado `minecraft-backups`.
3. Anota el **S3 API URL** del bucket (este será tu `S3_ENDPOINT`).
4. Ve a **Manage R2 API Tokens** y crea un nuevo token con permisos de **Object Read & Write**.
5. Copia el **Access Key ID** y el **Secret Access Key**.

### 3. Despliegue en Render
1. Haz un Fork o sube este repositorio a tu propio GitHub.
2. Ve a [Render.com](https://render.com/), crea un nuevo **Web Service** y conéctalo a tu repositorio.
3. El archivo `render.yaml` incluido configurará automáticamente el entorno de Node.js + Java.
4. En la pestaña **Environment** de tu servicio en Render, debes agregar **manualmente** estas 5 variables de entorno usando los datos de los pasos anteriores:

| Variable | Descripción (Ejemplo) |
|---|---|
| `DATABASE_URL` | `mysql://...` (Tu conexión de TiDB) |
| `S3_ENDPOINT` | `https://<id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | `minecraft-backups` |
| `S3_ACCESS_KEY` | Tu Access Key de Cloudflare |
| `S3_SECRET_KEY` | Tu Secret Key de Cloudflare |

5. Despliega el proyecto. Cuando termine, abre la URL proporcionada por Render, créate una cuenta y ¡accede a tu panel!

---

## ⚡ Truco: Arranque Instantáneo con `template.zip`

El motor de Minecraft tarda bastante en descargar archivos base y generar un nuevo mundo por primera vez (sobre todo en el plan gratuito de Render). Para saltarte esto:

1. Crea un servidor local en tu PC, enciéndelo para que genere el mapa y los archivos (o usa un servidor que ya tengas).
2. Selecciona todos los archivos del servidor (donde está `server.properties`, la carpeta `world`, etc.) y **comprímelos en un archivo llamado exactamente `template.zip`**.
3. Sube ese archivo manualmente a la raíz de tu bucket en Cloudflare R2.
4. La próxima vez que inicies un servidor nuevo en el panel de Render, el sistema descargará el `template.zip`, lo descomprimirá y arrancará en unos cuantos segundos.

---

## 💻 Desarrollo Local

Si deseas probar o modificar el código en tu propia computadora:

1. Clona el repositorio e instala dependencias:
   ```bash
   npm install
   ```

2. Crea tu archivo `.env` basado en `.env.example`:
   ```bash
   cp .env.example .env
   ```
   Rellena tus credenciales de TiDB y S3.

3. Instala y sincroniza la base de datos con Prisma:
   ```bash
   cd backend
   npx prisma db push
   npx prisma generate
   cd ..
   ```

4. Arranca el entorno de desarrollo:
   ```bash
   npm run dev
   ```

5. Entra a `http://localhost:3000` en tu navegador.

---
*Desarrollado con ❤️ usando Node.js, Fastify y Prisma.*
