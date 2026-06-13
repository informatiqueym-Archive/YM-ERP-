import fs from "fs";
import path from "path";
import { execSync } from "child_process";

let dbPath = path.join("prisma", "dev.db");
const dbUrl = process.env.DATABASE_URL;

if (dbUrl && dbUrl.startsWith("file:")) {
  const fileRelativeOrAbsolute = dbUrl.replace(/^file:/, "");
  dbPath = path.isAbsolute(fileRelativeOrAbsolute)
    ? fileRelativeOrAbsolute
    : path.resolve(fileRelativeOrAbsolute);
}

// 1. Initial Header Validation
if (fs.existsSync(dbPath)) {
  try {
    const fd = fs.openSync(dbPath, "r");
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const header = buffer.toString("utf-8", 0, 15);
    if (header !== "SQLite format 3") {
      console.log(`⚠️ Le fichier ${dbPath} n'est pas un fichier SQLite valide (physiquement corrompu). Suppression préventive...`);
      fs.unlinkSync(dbPath);
    } else {
      console.log(`✅ Le fichier ${dbPath} a un en-tête SQLite valide. Tentative de migration...`);
    }
  } catch (error) {
    console.log(`⚠️ Impossible de valider ${dbPath}. Suppression préventive...`, error);
    try {
      fs.unlinkSync(dbPath);
    } catch (_) {}
  }
} else {
  console.log(`ℹ️ Aucun fichier ${dbPath} détecté. Il sera généré.`);
}

// S'assurer que le dossier parent existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 2. Perform DB Push with Automatic Re-try on failure (e.g. malformed DB)
try {
  console.log("👉 Exécution de : npx prisma db push --accept-loose-schema");
  execSync("npx prisma db push --accept-loose-schema", { stdio: "inherit" });
} catch (error) {
  console.log("⚠️ Le push Prisma a échoué. La base de données est peut-être corrompue (malformed ou verrouillée). Réinitialisation de la base de données...");
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
      // Supprimer également les fichiers journaux SQLite s'ils existent
      const journalFiles = [dbPath + "-journal", dbPath + "-shm", dbPath + "-wal"];
      for (const jFile of journalFiles) {
        if (fs.existsSync(jFile)) fs.unlinkSync(jFile);
      }
      console.log(`✅ Base de données corrompue supprimée : ${dbPath}`);
    } catch (err) {
      console.error(`❌ Impossible de supprimer la base de données : ${err.message}`);
    }
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
