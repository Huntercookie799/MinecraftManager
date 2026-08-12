import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { env } from "../../config/env";

export class S3SyncService {
  private client: S3Client | null = null;
  private bucket: string = "";

  constructor() {
    if (env.s3.endpoint && env.s3.bucket && env.s3.accessKey && env.s3.secretKey) {
      this.bucket = env.s3.bucket;
      // Extract region from endpoint if it's AWS, otherwise default to us-east-1 for MinIO/R2
      let region = "us-east-1";
      if (env.s3.endpoint.includes(".aws.")) {
        const match = env.s3.endpoint.match(/([a-z]{2}-[a-z]+-\d+)\.amazonaws\.com/);
        if (match) region = match[1];
      }

      this.client = new S3Client({
        region,
        endpoint: env.s3.endpoint,
        credentials: {
          accessKeyId: env.s3.accessKey,
          secretAccessKey: env.s3.secretKey
        },
        forcePathStyle: true // Needed for MinIO
      });
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  private async ensureBucketExists(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404) {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        console.log(`[S3SyncService] Bucket ${this.bucket} created.`);
      } else {
        throw error;
      }
    }
  }

  async downloadAndUnzip(targetDirectory: string, serverId: number | string, log: (msg: string) => void): Promise<void> {
    if (!this.client) {
      log("S3 Sync is not configured. Skipping download.");
      return;
    }

    try {
      await this.ensureBucketExists();
      log(`[S3SyncService] Downloading ${serverId}/server_backup.zip from S3...`);

      const getCommand = new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${serverId}/server_backup.zip`
      });

      const response = await this.client.send(getCommand);
      if (!response.Body) {
        log("[S3SyncService] Received empty body from S3.");
        return;
      }

      const tempZipPath = path.join(process.cwd(), "temp_download.zip");
      // Stream directo a disco: no carga el backup entero en memoria (los backups
      // de servidores con mundo pueden pesar cientos de MB).
      await pipeline(response.Body as any, fsSync.createWriteStream(tempZipPath));

      log(`[S3SyncService] Unzipping to ${targetDirectory}...`);
      await fs.mkdir(targetDirectory, { recursive: true });

      const zip = new AdmZip(tempZipPath);
      zip.extractAllTo(targetDirectory, true);

      await fs.unlink(tempZipPath);
      log(`[S3SyncService] Successfully restored server from S3.`);
    } catch (error: any) {
      if (error.name === "NoSuchKey") {
        log("[S3SyncService] No backup found. Looking for template.zip instead...");
        try {
          const templateCommand = new GetObjectCommand({
            Bucket: this.bucket,
            Key: "template.zip"
          });
          const templateResponse = await this.client.send(templateCommand);
          if (templateResponse.Body) {
            const tempZipPath = path.join(process.cwd(), "temp_download.zip");
            await pipeline(templateResponse.Body as any, fsSync.createWriteStream(tempZipPath));
            
            log(`[S3SyncService] Unzipping template.zip to ${targetDirectory}...`);
            await fs.mkdir(targetDirectory, { recursive: true });
            
            const zip = new AdmZip(tempZipPath);
            zip.extractAllTo(targetDirectory, true);
            
            await fs.unlink(tempZipPath);
            log(`[S3SyncService] Successfully loaded template from S3!`);
          }
        } catch (templateError: any) {
          if (templateError.name === "NoSuchKey") {
            log("[S3SyncService] No template.zip found either. Starting from scratch (generating new world).");
          } else {
            log(`[S3SyncService] Error downloading template: ${templateError.message}`);
          }
        }
      } else {
        log(`[S3SyncService] Error downloading from S3: ${error.message}`);
        console.error(error);
      }
    }
  }

  async zipAndUpload(sourceDirectory: string, serverId: number | string, log: (msg: string) => void): Promise<void> {
    if (!this.client) {
      log("S3 Sync is not configured. Skipping upload.");
      return;
    }

    try {
      await this.ensureBucketExists();
      log(`[S3SyncService] Zipping ${sourceDirectory}...`);

      const tempZipPath = path.join(process.cwd(), "temp_upload.zip");
      const zip = new AdmZip();
      zip.addLocalFolder(sourceDirectory);
      zip.writeZip(tempZipPath);

      const fileBuffer = await fs.readFile(tempZipPath);

      log(`[S3SyncService] Uploading ${serverId}/server_backup.zip to S3 (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

      const putCommand = new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${serverId}/server_backup.zip`,
        Body: fileBuffer
      });

      await this.client.send(putCommand);
      await fs.unlink(tempZipPath);
      log(`[S3SyncService] Successfully uploaded server to S3.`);
    } catch (error: any) {
      log(`[S3SyncService] Error uploading to S3: ${error.message}`);
      console.error(error);
    }
  }

  /**
   * Comprime y sube una carpeta específica (no todo el directorio del servidor).
   */
  async zipAndUploadFolder(
    folderPath: string,
    destinationKey: string,
    log: (msg: string) => void
  ): Promise<void> {
    if (!this.client) {
      log("S3 Sync is not configured. Skipping upload.");
      return;
    }

    try {
      await this.ensureBucketExists();
      log(`[S3SyncService] Zipping ${folderPath}...`);

      const tempZipPath = path.join(process.cwd(), `temp_upload_${Date.now()}.zip`);
      const zip = new AdmZip();

      // Agregar cada archivo/carpeta individualmente, ignorando los que estén bloqueados
      await this.addFolderToZip(zip, folderPath, "");
      zip.writeZip(tempZipPath);

      const fileBuffer = await fs.readFile(tempZipPath);

      log(`[S3SyncService] Uploading ${destinationKey} to S3 (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

      const putCommand = new PutObjectCommand({
        Bucket: this.bucket,
        Key: destinationKey,
        Body: fileBuffer
      });

      await this.client.send(putCommand);
      await fs.unlink(tempZipPath);
      log(`[S3SyncService] Successfully uploaded ${destinationKey}.`);
    } catch (error: any) {
      log(`[S3SyncService] Error uploading folder: ${error.message}`);
      console.error(error);
    }
  }

  /** Recorre un directorio y agrega cada archivo al zip, saltando los bloqueados. */
  private async addFolderToZip(zip: AdmZip, dirPath: string, zipPath: string): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      return; // directorio no accesible, saltar
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const entryZipPath = zipPath ? `${zipPath}/${entry}` : entry;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await this.addFolderToZip(zip, fullPath, entryZipPath);
        } else {
          try {
            const content = await fs.readFile(fullPath);
            zip.addFile(entryZipPath, content);
          } catch (e: any) {
            // Archivo bloqueado (EBUSY/EPERM) — saltar silenciosamente
            zip.addFile(entryZipPath, Buffer.from(`[locked] ${e.message}`));
          }
        }
      } catch {
        // No se pudo stat — saltar
      }
    }
  }

  async listObjects(prefix: string = "") {
    if (!this.client) {
      throw new Error("S3 Sync is not configured");
    }
    await this.ensureBucketExists();
    
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix
    });

    const response = await this.client.send(command);
    return response.Contents?.map(item => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified
    })) || [];
  }
}
