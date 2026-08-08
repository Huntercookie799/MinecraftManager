import bcrypt from "bcrypt";
import { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export async function registerAuthRoutes(app: FastifyInstance) {
  // Login
  app.post("/login", async (request, reply) => {
    const { username, password } = request.body as any;

    if (!username || !password) {
      return reply.status(400).send({ error: "Username and password required" });
    }

    const user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const token = app.jwt.sign({ id: user.id, username: user.username, role: user.role });
    return { token };
  });

  // Register
  app.post("/register", async (request, reply) => {
    const { username, password } = request.body as any;

    if (!username || !password || username.length < 3 || password.length < 4) {
      return reply.status(400).send({ error: "Username (min 3) and password (min 4) required" });
    }

    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) {
      return reply.status(400).send({ error: "Username already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: "user"
      }
    });

    const token = app.jwt.sign({ id: user.id, username: user.username, role: user.role });
    return { token };
  });

  // The following routes require authentication
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook("onRequest", (protectedRoutes as any).authenticate);

    // Get current user profile
    protectedRoutes.get("/me", async (request, reply) => {
      const { id } = request.user as any;
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return reply.status(404).send({ error: "User not found" });

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        profilePic: user.profilePic,
        mcSkin: user.mcSkin,
        createdAt: user.createdAt
      };
    });

    // Update current user profile text data
    protectedRoutes.put("/me", async (request, reply) => {
      const { id } = request.user as any;
      const { username, password } = request.body as any;

      const dataToUpdate: any = {};
      if (username) dataToUpdate.username = username;
      if (password) dataToUpdate.password = await bcrypt.hash(password, 10);

      try {
        const user = await prisma.user.update({
          where: { id },
          data: dataToUpdate
        });
        return { success: true, username: user.username };
      } catch (e: any) {
        if (e.code === 'P2002') return reply.status(400).send({ error: "Username taken" });
        throw e;
      }
    });

    // Upload profile pic or skin
    protectedRoutes.post("/me/upload", async (request, reply) => {
      const { id } = request.user as any;
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });

      // Determine upload type based on field name: "profilePic" or "mcSkin"
      const fieldName = data.fieldname;
      if (fieldName !== "profilePic" && fieldName !== "mcSkin") {
        return reply.status(400).send({ error: "Invalid field name. Use 'profilePic' or 'mcSkin'." });
      }

      // Ensure uploads directory exists
      const uploadsDir = path.join(__dirname, "..", "..", "public", "uploads");
      await fs.mkdir(uploadsDir, { recursive: true });

      // Save file
      const ext = path.extname(data.filename).toLowerCase() || '.png';
      const fileName = `${fieldName}_${id}_${Date.now()}${ext}`;
      const filePath = path.join(uploadsDir, fileName);
      
      await pipeline(data.file, require('node:fs').createWriteStream(filePath));

      // Update db
      const relativeUrl = `/uploads/${fileName}`;
      
      // Delete old file if exists
      const user = await prisma.user.findUnique({ where: { id } });
      if (user && user[fieldName]) {
        try {
          const oldPath = path.join(__dirname, "..", "..", "public", user[fieldName]);
          await fs.unlink(oldPath);
        } catch(e) { /* ignore */ }
      }

      await prisma.user.update({
        where: { id },
        data: { [fieldName]: relativeUrl }
      });

      return { success: true, url: relativeUrl };
    });
    // --- MINECRAFT ACCOUNTS ---

    protectedRoutes.get("/me/accounts", async (request, reply) => {
      const { id } = request.user as any;
      const accounts = await prisma.minecraftAccount.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'asc' }
      });
      return reply.send(accounts);
    });

    protectedRoutes.post("/me/accounts", async (request, reply) => {
      const { id } = request.user as any;
      const { nametag } = request.body as any;
      
      if (!nametag) return reply.status(400).send({ error: "Nametag is required" });

      const account = await prisma.minecraftAccount.create({
        data: {
          nametag,
          userId: id
        }
      });
      return reply.send(account);
    });

    protectedRoutes.delete("/me/accounts/:accountId", async (request, reply) => {
      const { id } = request.user as any;
      const { accountId } = request.params as any;

      // Verify ownership
      const account = await prisma.minecraftAccount.findUnique({ where: { id: parseInt(accountId) } });
      if (!account || account.userId !== id) {
        return reply.status(403).send({ error: "Unauthorized or not found" });
      }

      await prisma.minecraftAccount.delete({ where: { id: parseInt(accountId) } });
      return reply.send({ success: true });
    });

    protectedRoutes.post("/me/accounts/:accountId/upload", async (request, reply) => {
      const { id } = request.user as any;
      const { accountId } = request.params as any;
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });

      const fieldName = data.fieldname;
      if (fieldName !== "avatar" && fieldName !== "skin") {
        return reply.status(400).send({ error: "Invalid field name. Use 'avatar' or 'skin'." });
      }

      // Verify ownership
      const account = await prisma.minecraftAccount.findUnique({ where: { id: parseInt(accountId) } });
      if (!account || account.userId !== id) {
        return reply.status(403).send({ error: "Unauthorized or not found" });
      }

      const uploadsDir = path.join(__dirname, "..", "..", "public", "uploads");
      await fs.mkdir(uploadsDir, { recursive: true });

      const ext = path.extname(data.filename).toLowerCase() || '.png';
      const fileName = `acc_${accountId}_${fieldName}_${Date.now()}${ext}`;
      const filePath = path.join(uploadsDir, fileName);
      
      await pipeline(data.file, require('node:fs').createWriteStream(filePath));
      const relativeUrl = `/uploads/${fileName}`;
      
      // Delete old file
      if (account[fieldName as keyof typeof account]) {
        try {
          const oldPath = path.join(__dirname, "..", "..", "public", account[fieldName as keyof typeof account] as string);
          await fs.unlink(oldPath);
        } catch(e) { /* ignore */ }
      }

      await prisma.minecraftAccount.update({
        where: { id: parseInt(accountId) },
        data: { [fieldName]: relativeUrl }
      });

      return reply.send({ success: true, url: relativeUrl });
    });

  });
}
