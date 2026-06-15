import fs from "fs";
import path from "path";
import { execSync } from "child_process";

let dbPath = path.resolve("prisma", "dev.db");
const dbUrl = process.env.DATABASE_URL;

if (dbUrl && dbUrl.startsWith("file:")) {
  const filePath = dbUrl.substring(5); // Enlever "file:"
  dbPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve("prisma", filePath); // Résoudre par rapport au dossier prisma pour correspondre à Prisma !
}

// 1. Helper function to delete files or directories safely
function safeDelete(p) {
  if (fs.existsSync(p)) {
    try {
      const stats = fs.statSync(p);
      if (stats.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log(`✅ Dossier supprimé avec succès : ${p}`);
      } else {
        fs.unlinkSync(p);
        console.log(`✅ Fichier supprimé avec succès : ${p}`);
      }
    } catch (err) {
      console.error(`❌ Impossible de supprimer ${p}: ${err.message}`);
    }
  }
}

// 2. Initial Header/Type Validation
if (fs.existsSync(dbPath)) {
  try {
    const stats = fs.statSync(dbPath);
    if (stats.isDirectory()) {
      console.log(`⚠️ ${dbPath} est un dossier (erreur Docker/Coolify de volume possible). Suppression récursive...`);
      safeDelete(dbPath);
    } else {
      const fd = fs.openSync(dbPath, "r");
      const buffer = Buffer.alloc(16);
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);

      const header = buffer.toString("utf-8", 0, 15);
      if (header !== "SQLite format 3") {
        console.log(`⚠️ Le fichier ${dbPath} n'est pas un fichier SQLite valide (physiquement corrompu). Suppression préventive...`);
        safeDelete(dbPath);
      } else {
        console.log(`✅ Le fichier ${dbPath} a un en-tête SQLite valide. Tentative de migration...`);
      }
    }
  } catch (error) {
    console.log(`⚠️ Impossible de valider ${dbPath}. Suppression préventive...`, error);
    safeDelete(dbPath);
  }
} else {
  console.log(`ℹ️ Aucun fichier ${dbPath} détecté. Il sera généré.`);
}

// S'assurer que le dossier parent existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 3. Perform DB Push with Automatic Re-try on failure (e.g. malformed DB)
try {
  console.log("👉 Exécution de : npx prisma db push --accept-loose-schema");
  execSync("npx prisma db push --accept-loose-schema", { stdio: "inherit" });
} catch (error) {
  console.log("⚠️ Le push Prisma a échoué. La base de données est peut-être corrompue (malformed ou verrouillée). Réinitialisation de la base de données...");
  safeDelete(dbPath);
  // Supprimer également les fichiers journaux SQLite s'ils existent
  const journalFiles = [dbPath + "-journal", dbPath + "-shm", dbPath + "-wal"];
  for (const jFile of journalFiles) {
    safeDelete(jFile);
  }
  
  // Réessayer avec une base propre
  console.log("👉 Re-tentative de push sur une nouvelle base de données...");
  execSync("npx prisma db push --accept-loose-schema", { stdio: "inherit" });
}

// 3. Seed Database
try {
  const seedPath = path.resolve("dist", "seed.cjs");
  if (fs.existsSync(seedPath)) {
    console.log("👉 Exécution de : node dist/seed.cjs");
    execSync("node dist/seed.cjs", { stdio: "inherit" });
  } else {
    console.log("ℹ️ Fichier seed.cjs introuvable dans dist/. Étape du seed ignorée.");
  }
} catch (error) {
  console.error("⚠️ Échec du peuplement (seed) de la base de données:", error);
}

console.log("✅ Base de données initialisée avec succès !");
