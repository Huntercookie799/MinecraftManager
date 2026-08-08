import { PrismaClient } from "@prisma/client";
import "dotenv/config";

export const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});
