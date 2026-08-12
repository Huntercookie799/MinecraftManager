# 🗺️ Arquitectura — Minecraft Manager

> Documento vivo. El **grafo de dependencias** de abajo se regenera automáticamente con:
> ```bash
> node scripts/gen-arch-graph.mjs
> ```

## Vista de capas (alto nivel)

```mermaid
flowchart TB
  subgraph Browser["🌐 Navegador"]
    HTML["public/*.html"]
    PAGES["public/js/pages/*.js"]
    COMP["public/js/components/*.js"]
    MODELS["public/js/models/*.js"]
    UTILS["public/js/utils/*.js"]
  end

  subgraph API["🚀 Backend (Fastify)"]
    BOOT["server.ts → bootstrap/app.ts"]
    ROUTES["routes/api.ts (JWT auth)"]
    AUTH["AuthController"]
    SRV["ServerController"]
    WLD["WorldController"]
    WS["Websockets/logs.ts"]
    SVC["ServerManager / MinecraftService / JarManager / PortForwardService / S3SyncService"]
    PRISMA["prisma (PrismaClient)"]
    ENV["config/env.ts"]
  end

  subgraph External["🌍 Externos"]
    DB[("MySQL / TiDB")]
    S3[("S3 / Cloudflare R2")]
    JAR[("Purpur/Paper JAR")]
    JVM[("☕ Proceso Java")]
  end

  HTML --> PAGES
  PAGES --> COMP & MODELS & UTILS
  MODELS --> UTILS

  PAGES -->|HTTP /api + WS /ws| ROUTES & WS
  ROUTES --> AUTH & SRV & WLD
  AUTH --> PRISMA
  SRV & WLD --> SVC
  SRV & WLD --> PRISMA
  SVC --> PRISMA
  SVC --> JAR
  SVC --> S3
  SVC --> JVM
  WS --> SVC
  WS --> PRISMA
  BOOT --> ROUTES & ENV & PRISMA
```

## Glosario de capas

| Capa | Dónde | Responsabilidad |
|---|---|---|
| **Bootstrap** | `server.ts`, `bootstrap/app.ts` | Levanta Fastify, registra rutas, restaura forwarders/adopción al arrancar |
| **Rutas API** | `routes/api.ts` | Prefijos `/auth`, `/server`, `/server/:id/worlds` + middleware JWT |
| **Controladores** | `app/Http/Controllers/` | Auth, Server, World — parsean requests, orquestan servicios |
| **WebSockets** | `app/Websockets/logs.ts` | Logs en vivo del servidor MC hacia el navegador |
| **Servicios** | `app/Services/` | `MinecraftService` (spawn/adopt/status), `JarManager` (descargas), `PortForwardService` (proxy TCP 80/443), `S3SyncService` (backups), `ServerManager` (registry) |
| **Infra** | `app/Models/prisma.ts`, `app/Utils/`, `app/Types/`, `config/env.ts` | Cliente Prisma, RingBuffer de logs, tipos compartidos, env |
| **Esquema** | `prisma/schema/*.prisma` | Modelos: User, Token, Server, World, ServerLog, MinecraftAccount |
| **Frontend** | `public/` | HTML por página + JS modular (pages → components/models/utils) |

## Rutas del servidor Minecraft

- **Consola/estado**: `MinecraftService` escribe en stdin de la JVM, lee stdout → `RingBuffer` → WebSocket.
- **Persistencia**: `S3SyncService` zip/upload del mundo al apagar → download/unzip al encender.
- **Exposición**: `PortForwardService` reenvía puerto público (80/443) al puerto interno, restaurado al arrancar el backend.
- **Personalización**: MOTD + `server-icon.png` se escriben en `server.properties` al iniciar.

## Grafo de dependencias (generado)

<!-- GRAPH:START -->

```mermaid
flowchart LR
  %% Generado por scripts/gen-arch-graph.mjs — no editar a mano
  subgraph _Bootstrap["🚀 Bootstrap"]
    n13["bootstrap/app.ts"]
    n49["server.ts"]
  end
  subgraph _Rutas_API["🧭 Rutas API"]
    n48["routes/api.ts"]
  end
  subgraph _Controladores["🎮 Controladores"]
    n1["app/Http/Controllers/AuthController.ts"]
    n2["app/Http/Controllers/ServerController.ts"]
    n3["app/Http/Controllers/WorldController.ts"]
  end
  subgraph _WebSockets["🔌 WebSockets"]
    n12["app/Websockets/logs.ts"]
  end
  subgraph _Servicios["⚙️ Servicios"]
    n5["app/Services/JarManager.ts"]
    n6["app/Services/MinecraftService.ts"]
    n7["app/Services/PortForwardService.ts"]
    n8["app/Services/S3SyncService.ts"]
    n9["app/Services/ServerManager.ts"]
  end
  subgraph _Infra_prismaenvutils["🧩 Infra (prisma/env/utils)"]
    n4["app/Models/prisma.ts"]
    n10["app/Types/server.ts"]
    n11["app/Utils/ringBuffer.ts"]
    n14["config/env.ts"]
  end
  subgraph _Frontend__Pginas["🖥️ Frontend — Páginas"]
    n28["public/js/pages/dashboard.js"]
    n29["public/js/pages/login.js"]
    n30["public/js/pages/profile.js"]
    n31["public/js/pages/server-console.js"]
    n32["public/js/pages/server-files.js"]
    n33["public/js/pages/server-header.js"]
    n34["public/js/pages/server-players.js"]
    n35["public/js/pages/server-settings.js"]
    n36["public/js/pages/server-worlds.js"]
    n37["public/js/pages/server.js"]
  end
  subgraph _Frontend__Componentes["🧱 Frontend — Componentes"]
    n17["public/js/components/UIButton.js"]
    n18["public/js/components/UIInput.js"]
    n19["public/js/components/UIModal.js"]
    n20["public/js/components/UIProgress.js"]
    n21["public/js/components/UISidebar.js"]
    n22["public/js/components/UITable.js"]
    n23["public/js/components/UIThemeToggle.js"]
    n24["public/js/components/index.js"]
  end
  subgraph _Frontend__Modelos["📦 Frontend — Modelos"]
    n25["public/js/models/Server.js"]
    n26["public/js/models/User.js"]
    n27["public/js/models/World.js"]
  end
  subgraph _Frontend__Utilidades["🛠️ Frontend — Utilidades"]
    n38["public/js/utils/CommandAutocomplete.js"]
    n39["public/js/utils/api.js"]
    n40["public/js/utils/dom.js"]
  end
  subgraph _HTML["📄 HTML"]
    n15["public/dashboard.html"]
    n16["public/index.html"]
    n41["public/profile.html"]
    n42["public/server-console.html"]
    n43["public/server-files.html"]
    n44["public/server-players.html"]
    n45["public/server-settings.html"]
    n46["public/server-worlds.html"]
    n47["public/server.html"]
  end
  n1 --> n4
  n2 --> n9
  n2 --> n6
  n2 --> n4
  n2 --> n14
  n2 --> n8
  n2 --> n5
  n2 --> n7
  n3 --> n4
  n3 --> n9
  n3 --> n8
  n5 --> n14
  n6 --> n4
  n6 --> n14
  n6 --> n10
  n6 --> n11
  n6 --> n8
  n6 --> n5
  n8 --> n14
  n9 --> n6
  n12 --> n9
  n12 --> n10
  n12 --> n4
  n48 --> n1
  n48 --> n2
  n48 --> n3
  n24 --> n17
  n24 --> n18
  n24 --> n22
  n24 --> n19
  n21 --> n39
  n23 --> n17
  n25 --> n39
  n26 --> n39
  n27 --> n39
  n28 --> n39
  n28 --> n40
  n28 --> n25
  n28 --> n24
  n28 --> n20
  n29 --> n40
  n29 --> n26
  n29 --> n39
  n29 --> n24
  n29 --> n20
  n30 --> n39
  n30 --> n40
  n30 --> n26
  n30 --> n24
  n30 --> n20
  n31 --> n39
  n31 --> n40
  n31 --> n25
  n31 --> n38
  n31 --> n24
  n31 --> n33
  n32 --> n39
  n32 --> n40
  n32 --> n33
  n33 --> n39
  n33 --> n40
  n33 --> n25
  n34 --> n40
  n34 --> n24
  n34 --> n33
  n35 --> n39
  n36 --> n40
  n36 --> n27
  n36 --> n24
  n36 --> n33
  n37 --> n39
  n37 --> n40
  n37 --> n25
  n37 --> n24
  n37 --> n20
  n37 --> n33
  n15 --> n24
  n15 --> n21
  n15 --> n23
  n15 --> n28
  n16 --> n24
  n16 --> n23
  n16 --> n29
  n41 --> n24
  n41 --> n21
  n41 --> n23
  n41 --> n30
  n42 --> n24
  n42 --> n21
  n42 --> n23
  n42 --> n31
  n43 --> n24
  n43 --> n21
  n43 --> n23
  n43 --> n32
  n44 --> n24
  n44 --> n21
  n44 --> n23
  n44 --> n34
  n45 --> n24
  n45 --> n21
  n45 --> n23
  n45 --> n35
  n46 --> n24
  n46 --> n21
  n46 --> n23
  n46 --> n36
  n47 --> n24
  n47 --> n21
  n47 --> n23
  n47 --> n37
  n49 --> n13
  n49 --> n14
  n49 --> n4
  n49 --> n9
  n49 --> n7
```

<!-- GRAPH:END -->

## Regenerar

```bash
node scripts/gen-arch-graph.mjs
```

Escanea `app/`, `routes/`, `public/` y `prisma/` por imports relativos y reemplaza el bloque entre los marcadores. Útil como **mapa mental** antes de tocar código: mirá el grafo y sabés qué toca cada módulo.
