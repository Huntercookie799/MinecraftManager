import { describe, expect, it } from "vitest";
import { applyServerPort } from "./serverProperties";

describe("applyServerPort", () => {
  it("reemplaza el server-port existente por el puerto asignado", () => {
    const content = "server-port=443\nmotd=hola\n";
    expect(applyServerPort(content, 25565)).toBe("server-port=25565\nmotd=hola\n");
  });

  it("no toca management-server-port y escribe el server-port correcto", () => {
    // Caso real del bug: el backup de S3 trae server-port=443 y además
    // management-server-port=25565. La regex sin ancla matcheaba DENTRO de
    // "management-server-port=" primero y el replace era un no-op, dejando
    // server-port=443 intacto (Java crasheaba al bindear 443).
    const content = "management-server-port=25565\nserver-port=443\n";
    const result = applyServerPort(content, 25565);
    expect(result).toContain("management-server-port=25565");
    expect(result).toContain("server-port=25565");
    expect(result).not.toContain("server-port=443");
  });

  it("agrega server-port al final si no existe ninguna línea", () => {
    const content = "motd=hola\n";
    const result = applyServerPort(content, 25566);
    expect(result).toBe("motd=hola\n\nserver-port=25566\n");
  });

  it("no modifica el resto de las líneas", () => {
    const content = "level-name=world\nserver-port=443\nmax-players=20\n";
    const result = applyServerPort(content, 25565);
    expect(result).toContain("level-name=world");
    expect(result).toContain("max-players=20");
    expect(result).not.toContain("server-port=443");
  });

  it("es idempotente cuando el puerto ya es el correcto", () => {
    const content = "server-port=25565\n";
    expect(applyServerPort(content, 25565)).toBe(content);
  });

  it("maneja contenido vacío", () => {
    expect(applyServerPort("", 25565)).toBe("\nserver-port=25565\n");
  });
});
