import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env";

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

  async downloadAndUnzip(targetDirectory: string, log: (msg: string) => void): Promise<void> {
    if (!this.client) {
      log("S3 Sync is not configured. Skipping download.");
      return;
    }

    try {
      await this.ensureBucketExists();
      log(`[S3SyncService] Downloading server_backup.zip from S3...`);

      const getCommand = new GetObjectCommand({
        Bucket: this.bucket,
        Key: "server_backup.zip"
      });

      const response = await this.client.send(getCommand);
      const byteArray = await response.Body?.transformToByteArray();

      if (!byteArray) {
        log("[S3SyncService] Received empty body from S3.");
        return;
      }

      const tempZipPath = path.join(process.cwd(), "temp_download.zip");
      await fs.writeFile(tempZipPath, byteArray);

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
          const templateByteArray = await templateResponse.Body?.transformToByteArray();
          
          if (templateByteArray) {
            const tempZipPath = path.join(process.cwd(), "temp_download.zip");
            await fs.writeFile(tempZipPath, templateByteArray);
            
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

  async zipAndUpload(sourceDirectory: string, log: (msg: string) => void): Promise<void> {
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

      log(`[S3SyncService] Uploading server_backup.zip to S3 (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

      const putCommand = new PutObjectCommand({
        Bucket: this.bucket,
        Key: "server_backup.zip",
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
}
