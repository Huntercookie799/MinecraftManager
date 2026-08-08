import bcrypt from "bcrypt";
import { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma";

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/login", async (request, reply) => {
    const { username, password } = request.body as any;

    if (!username || !password) {
      return reply.status(400).send({ error: "Username and password required" });
    }

    const user = await prisma.user.findUnique({
      where: { username }
    });

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
}
