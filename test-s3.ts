import fs from "node:fs/promises";
import path from "node:path";
import { S3SyncService } from "./backend/src/services/S3SyncService.js";

async function runTest() {
  console.log("Iniciando prueba de S3 con Cloudflare R2...");
  const s3Sync = new S3SyncService();
  
  if (!s3Sync.isConfigured) {
    console.error("Error: S3SyncService dice que no está configurado.");
    return;
  }

  const testDir = path.join(process.cwd(), "minecraft_test");
  const downloadDir = path.join(process.cwd(), "minecraft_test_download");

  try {
    // 1. Create a dummy directory with a file to simulate minecraft/server
    console.log("1. Creando carpeta de prueba...");
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, "server.properties"), "server-port=25565\nlevel-name=world");
    await fs.writeFile(path.join(testDir, "eula.txt"), "eula=true");

    // 2. Upload to S3
    console.log("2. Subiendo a Cloudflare R2...");
    await s3Sync.zipAndUpload(testDir, console.log);

    // 3. Download from S3 to a different folder
    console.log("3. Descargando desde Cloudflare R2...");
    await s3Sync.downloadAndUnzip(downloadDir, console.log);

    // 4. Verify contents
    const content = await fs.readFile(path.join(downloadDir, "server.properties"), "utf-8");
    if (content.includes("level-name=world")) {
      console.log("✅ ¡Éxito! El archivo se subió, descargó y descomprimió correctamente.");
    } else {
      console.error("❌ Fallo: El contenido del archivo no coincide.");
    }

  } catch (error) {
    console.error("Error en la prueba:", error);
  } finally {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  }
}

runTest();
