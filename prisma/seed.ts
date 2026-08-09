import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("Iniciando seeder...");

  // Verificar si ya existe un admin
  const adminExists = await prisma.user.findFirst({
    where: { role: "admin" }
  });

  if (!adminExists) {
    console.log("No se encontró usuario administrador. Creando admin por defecto...");
    const hashedPassword = await bcrypt.hash("admin", 10);
    
    await prisma.user.create({
      data: {
        username: "admin",
        password: hashedPassword,
        role: "admin",
      }
    });
    console.log("Usuario creado: admin / admin");
  } else {
    console.log("El usuario administrador ya existe. Se omitió la creación.");
  }

  console.log("Seeder finalizado.");
}

main()
  .catch((e) => {
    console.error("Error ejecutando el seeder:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
