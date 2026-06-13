import fs from "fs";
import path from "path";

let dbPath = path.join("prisma", "dev.db");
const dbUrl = process.env.DATABASE_URL;

if (dbUrl && dbUrl.startsWith("file:")) {
  const fileRelativeOrAbsolute = dbUrl.replace(/^file:/, "");
  dbPath = path.isAbsolute(fileRelativeOrAbsolute)
    ? fileRelativeOrAbsolute
    : path.resolve(fileRelativeOrAbsolute);
}

if (fs.existsSync(dbPath)) {
  try {
    const fd = fs.openSync(dbPath, "r");
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const header = buffer.toString("utf-8", 0, 15);
    if (header !== "SQLite format 3") {
      console.log(`⚠️ Le fichier ${dbPath} n'est pas un fichier SQLite valide (physiquement corrompu par Git lors du push/pull). Suppression pour régénération...`);
      fs.unlinkSync(dbPath);
    } else {
      console.log(`✅ Le fichier ${dbPath} a un en-tête SQLite valide.`);
    }
  } catch (error) {
    console.log(`⚠️ Impossible de valider ${dbPath}. Suppression préventive...`, error);
    try {
      fs.unlinkSync(dbPath);
    } catch (_) {}
  }
} else {
  console.log(`ℹ️ Aucun fichier ${dbPath} détecté. Il sera généré au démarrage.`);
}
