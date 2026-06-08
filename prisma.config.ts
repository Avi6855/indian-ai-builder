import * as dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Loads .env.local in local dev; safely ignored on Vercel (env vars injected automatically)
dotenv.config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"]!,
  },
});
