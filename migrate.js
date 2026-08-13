const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE serverdeathmessage ADD COLUMN playerName VARCHAR(191) NULL`);
    console.log("Column added");
  } catch (e) {
    console.log("Error adding column:", e.message);
  }
  
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE serverdeathmessage DROP INDEX \`ServerDeathMessage_serverId_dimension_key\``);
    console.log("Old index dropped");
  } catch (e) {
    console.log("Error dropping old index:", e.message);
  }
  
  try {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX \`ServerDeathMessage_serverId_dimension_playerName_key\` ON serverdeathmessage(serverId, dimension, playerName)`);
    console.log("New index created");
  } catch (e) {
    console.log("Error creating new index:", e.message);
  }
}

main().finally(() => prisma.$disconnect());
