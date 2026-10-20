import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSwaggerSpec } from "../src/swagger.js";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const outputDirectory = path.resolve(scriptDirectory, "../public");
const outputPath = path.join(outputDirectory, "openapi.json");

const swaggerSpec = createSwaggerSpec({
  serverUrl: process.env.SWAGGER_SERVER_URL || "http://localhost:4000",
});

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(swaggerSpec, null, 2)}\n`);

console.log(`Generated Swagger spec at ${outputPath}`);
