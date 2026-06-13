import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth, requireModule } from "./rbac";

const router = Router();
const prisma = new PrismaClient();

// Protéger toutes les routes de ce fichier avec la restriction de module dossiers
router.use(requireAuth, requireModule("dossiers"));

// Config Multer pour gestion des pièces jointes dossiers
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const id = req.params.id;
    const dir = path.join(process.cwd(), "uploads", "dossiers", id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Nom propre sécurisé pour éviter tout conflit
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const cleanedName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${uniqueSuffix}-${cleanedName}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Uniquement les fichiers PDF
    const filetypes = /pdf$/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Seuls les fichiers PDF sont acceptés !"));
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Helper de log
async function logActivity(userId: number, action: string, entity: string, entityId?: number | string) {
  try {
    await prisma.activityLog.create({
      data: {
        user_id: userId,
        action,
        entity,
        entity_id: entityId !== undefined && entityId !== null ? String(entityId) : null,
      },
    });
  } catch (error) {
    console.error("Erreur log dossiers route :", error);
  }
}

// GET /dossiers - Index (liste complète avec recherche Javascript client-side et dropdowns)
router.get("/dossiers", requireAuth, async (req: any, res: any) => {
  try {
    const { client_id, etat } = req.query;

    const filterObj: any = {};
    if (client_id) {
      filterObj.client_id = parseInt(client_id);
    }
    if (etat) {
      filterObj.etat = etat;
    }

    const [dossiers, clients] = await Promise.all([
      prisma.dossier.findMany({
        where: filterObj,
        include: {
          client: true,
          taches: true,
        },
        orderBy: {
          created_at: "desc",
        },
      }),
      prisma.client.findMany({ orderBy: { nom: "asc" } }),
    ]);

    res.render("dossiers/index", {
      dossiers,
      clients,
      selectedClientId: client_id || "",
      selectedEtat: etat || "",
      title: "Gestion des Dossiers de Transit",
    });
  } catch (error) {
    console.error("Erreur listing dossiers :", error);
    res.status(500).send("Erreur lors de la récupération des dossiers.");
  }
});

// GET /dossiers/create - Formulaire de création de dossiers
router.get("/dossiers/create", requireAuth, async (req: any, res: any) => {
  try {
    const clients = await prisma.client.findMany({ orderBy: { nom: "asc" } });
    res.render("dossiers/create", {
      clients,
      title: "Ouvrir un Dossier de Transit Maritime & Douanier",
    });
  } catch (error) {
    console.error("Erreur init formulaire dossier :", error);
    res.status(500).send("Erreur d'initialisation du formulaire.");
  }
});

// POST /dossiers/create - Enregistrement d'un dossier (et route compatible /dossiers/new)
const handleDossierCreation = async (req: any, res: any) => {
  try {
    const { client_id, numero, port, nature, etat, bl, contenu, droits_douane, validation, valeur_douane } = req.body;

    if (!client_id || !numero || !port || !nature || !bl) {
      req.session.error_msg = "Veuillez remplir correctement tous les champs obligatoires (*), y compris le N° de BL.";
      return res.redirect("/dossiers/create");
    }

    const clientIdParsed = parseInt(client_id);

    // Vérifier l'unicité du numéro de dossier
    const existing = await prisma.dossier.findUnique({
      where: { numero: numero.trim() },
    });

    if (existing) {
      req.session.error_msg = `Le numéro de dossier ${numero} est déjà utilisé par une autre expédition.`;
      return res.redirect("/dossiers/create");
    }

    const parsedDroits = droits_douane ? parseFloat(droits_douane) : null;
    const parsedValeur = valeur_douane ? parseFloat(valeur_douane) : null;
    const validationBool = (validation === 'true' || validation === true || validation === 'on');

    const newDossier = await prisma.dossier.create({
      data: {
        client_id: clientIdParsed,
        numero: numero.trim(),
        port: port,
        nature: nature,
        bl: bl.trim(),
        etat: etat || "OUVERT",
        contenu: contenu || null,
        droits_douane: parsedDroits,
        validation: validationBool,
        valeur_douane: parsedValeur,
      },
    });

    await logActivity(
      req.session.userId,
      "OUVERTURE_DOSSIER",
      "Dossier",
      newDossier.id
    );

    req.session.success_msg = `Dossier ${newDossier.numero} ouvert avec succès pour le suivi maritime !`;
    res.redirect(`/dossiers/${newDossier.id}`);
  } catch (error) {
    console.error("Erreur de création du dossier :", error);
    req.session.error_msg = "Une erreur est survenue lors de la création du dossier.";
    res.redirect("/dossiers/create");
  }
};

router.post("/dossiers/create", requireAuth, handleDossierCreation);
router.post("/dossiers/new", requireAuth, handleDossierCreation);

// POST /dossiers/:id/update-custom - Mettre à jour les détails de douane, marchandises, client et conteneur
router.post("/dossiers/:id/update-custom", requireAuth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const { client_id, bl, contenu, droits_douane, validation, valeur_douane } = req.body;

    const data: any = {};
    if (client_id) {
      data.client_id = parseInt(client_id);
    }
    if (bl !== undefined) {
      data.bl = bl ? bl.trim() : "";
    }
    if (contenu !== undefined) {
      data.contenu = contenu ? contenu.trim() : null;
    }
    if (droits_douane !== undefined) {
      data.droits_douane = droits_douane ? parseFloat(droits_douane) : null;
    }
    if (valeur_douane !== undefined) {
      data.valeur_douane = valeur_douane ? parseFloat(valeur_douane) : null;
    }
    
    // Si la checkbox n'est pas envoyée (ou vaut undefined), cela signifie qu'elle est désactivée
    data.validation = (validation === 'true' || validation === 'on' || validation === true);

    await prisma.dossier.update({
      where: { id },
      data,
    });

    await logActivity(
      req.session.userId,
      "MISE_A_JOUR_DETAILED_DOUANE",
      "Dossier",
      id
    );

    req.session.success_msg = "Informations logistiques et douanières actualisées.";
    res.redirect(`/dossiers/${id}`);
  } catch (error) {
    console.error("Erreur mise à jour infos douanières :", error);
    req.session.error_msg = "Erreur d'enregistrement des modifications.";
    res.redirect(`/dossiers/${req.params.id}`);
  }
});

// GET /dossiers/:id - Fiche détaillée (STAR)
router.get("/dossiers/:id", requireAuth, async (req: any, res: any) => {
  try {
    const folderId = parseInt(req.params.id);

    const dossier = await prisma.dossier.findUnique({
      where: { id: folderId },
      include: {
        client: true,
        taches: {
          include: {
            intervenant: true,
            subtasks: true,
          },
          orderBy: {
            created_at: "asc",
          },
        },
      },
    });

    if (!dossier) {
      req.session.error_msg = "Dossier de transit introuvable.";
      return res.redirect("/dossiers");
    }

    // 1. Invoices (Documents) related checking
    // Match by client to speed up, then filter matching dossier number inside document.numero or line.description
    const allDocs = await prisma.document.findMany({
      where: {
        client_id: dossier.client_id,
      },
      include: {
        lines: true,
        payments: true,
      },
      orderBy: {
        created_at: "desc",
      }
    });

    const linkedInvoices = allDocs.filter(doc => {
      const matchInNum = doc.numero.toUpperCase().includes(dossier.numero.toUpperCase());
      const matchInLines = doc.lines.some(l => l.description.toUpperCase().includes(dossier.numero.toUpperCase()));
      return matchInNum || matchInLines;
    });

    // 2. Attachments files reading
    const uploadDirPath = path.join(process.cwd(), "uploads", "dossiers", String(dossier.id));
    const attachments: Array<{ name: string; size: string; uploadedAt: string }> = [];

    if (fs.existsSync(uploadDirPath)) {
      const files = fs.readdirSync(uploadDirPath);
      files.forEach(f => {
        const stats = fs.statSync(path.join(uploadDirPath, f));
        attachments.push({
          name: f,
          size: `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
          uploadedAt: stats.mtime.toLocaleDateString("fr-FR"),
        });
      });
    }

    // 3. Activity timelines logs
    // Include logs specifically pointing to this dossier or to any of its tasks
    const taskIds = dossier.taches.map(t => t.id);
    const logs = await prisma.activityLog.findMany({
      where: {
        OR: [
          { entity: "Dossier", entity_id: String(dossier.id) },
          { entity: "Tache", entity_id: { in: taskIds.map(String) } },
        ],
      },
      include: {
        user: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const timeline = await prisma.activityLog.findMany({
      where: { entity: "dossier", entity_id: String(folderId) },
      include: { user: { select: { nom: true } } },
      orderBy: { created_at: "desc" },
      take: 40
    });

    // Envoi de tous les agents pour l'assignation de tâches rapides
    const [users, clients] = await Promise.all([
      prisma.user.findMany({
        where: { actif: true },
        orderBy: { nom: "asc" },
      }),
      prisma.client.findMany({
        orderBy: { nom: "asc" },
      })
    ]);

    res.render("dossiers/detail", {
      dossier,
      linkedInvoices,
      attachments,
      logs,
      timeline,
      users,
      clients,
      title: `Suivi Dossier - ${dossier.numero}`,
    });
  } catch (error) {
    console.error("Erreur chargement détail dossier :", error);
    res.status(500).send("Erreur lors de la récupération de la fiche détaillée.");
  }
});

// POST /dossiers/:id/upload - Upload de pièce jointe PDF
router.post("/dossiers/:id/upload", requireAuth, (req: any, res: any) => {
  upload.single("pdf_file")(req, res, async function (err: any) {
    const id = req.params.id;
    if (err) {
      req.session.error_msg = `Échec de l'import : ${err.message}`;
      return res.redirect(`/dossiers/${id}`);
    }

    if (!req.file) {
      req.session.error_msg = "Veuillez sélectionner un document PDF valide à importer.";
      return res.redirect(`/dossiers/${id}`);
    }

    await prisma.activityLog.create({
      data: {
        user_id: req.session.userId,
        action: 'fichier.uploaded',
        entity: 'dossier',
        entity_id: String(id),
        meta: JSON.stringify({ filename: req.file.originalname })
      }
    });

    await logActivity(
      req.session.userId,
      `IMPORT_PIECE_JOINTE_${req.file.filename.split("-").slice(2).join("-")}`,
      "Dossier",
      parseInt(id)
    );

    req.session.success_msg = `Pièce jointe importée avec succès : ${req.file.originalname}`;
    res.redirect(`/dossiers/${id}`);
  });
});

// GET /dossiers/:id/download/:filename - Téléchargement d'une pièce jointe
router.get("/dossiers/:id/download/:filename", requireAuth, (req: any, res: any) => {
  try {
    const id = req.params.id;
    const filename = req.params.filename;
    
    // Protection contre le path-traversal
    const safeFilename = path.basename(filename);
    const filePath = path.join(process.cwd(), "uploads", "dossiers", id, safeFilename);

    if (fs.existsSync(filePath)) {
      res.download(filePath, safeFilename);
    } else {
      res.status(404).send("Le fichier demandé n'existe pas ou a été retiré.");
    }
  } catch (error) {
    console.error("Erreur download :", error);
    res.status(500).send("Erreur interne du système lors du téléchargement.");
  }
});

// POST /dossiers/update-status/:id - Changement d'état logistique d'un dossier
router.post("/dossiers/update-status/:id", requireAuth, async (req: any, res: any) => {
  try {
    const folderId = parseInt(req.params.id);
    const { etat } = req.body;

    if (!etat) {
      req.session.error_msg = "État invalide.";
      return res.redirect("/dossiers");
    }

    await prisma.dossier.update({
      where: { id: folderId },
      data: { etat },
    });

    await logActivity(
      req.session.userId,
      `STATUS_DOSSIER_MOD_TO_${etat}`,
      "Dossier",
      folderId
    );

    req.session.success_msg = `Statut du dossier actualisé à : "${etat}"`;
    res.redirect(`/dossiers/${folderId}`);
  } catch (error) {
    console.error("Erreur statut dossier :", error);
    res.status(500).send("Erreur de traitement.");
  }
});

// POST /dossiers/delete/:id - Suppression d'un dossier
router.post("/dossiers/delete/:id", requireAuth, async (req: any, res: any) => {
  try {
    const folderId = parseInt(req.params.id);

    const ds = await prisma.dossier.findUnique({ where: { id: folderId } });
    if (!ds) {
      req.session.error_msg = "Dossier introuvable.";
      return res.redirect("/dossiers");
    }

    await prisma.dossier.delete({
      where: { id: folderId },
    });

    await logActivity(
      req.session.userId,
      `SUPPRESSION_DOSSIER_${ds.numero}`,
      "Dossier",
      folderId
    );

    // Supprimer aussi le dossier d'uploads correspondant physique
    const uploadDirPath = path.join(process.cwd(), "uploads", "dossiers", String(folderId));
    if (fs.existsSync(uploadDirPath)) {
      fs.rmSync(uploadDirPath, { recursive: true, force: true });
    }

    req.session.success_msg = `Dossier ${ds.numero} supprimé du système logistique.`;
    res.redirect("/dossiers");
  } catch (error) {
    console.error("Erreur suppression dossier :", error);
    res.status(500).send("Erreur de suppression.");
  }
});

// POST /dossiers/:id/taches/new - Ajouter un jalon d'étape rapide
router.post("/dossiers/:id/taches/new", requireAuth, async (req: any, res: any) => {
  const dossierId = parseInt(req.params.id);
  try {
    const { titre, intervenant_id, deadline, observations } = req.body;

    if (!titre) {
      req.session.error_msg = "Le titre de la tâche est obligatoire.";
      return res.redirect(`/dossiers/${dossierId}`);
    }

    const assignedAgentId = intervenant_id ? parseInt(intervenant_id) : null;
    const limitDate = deadline ? new Date(deadline) : null;

    const tache = await prisma.tache.create({
      data: {
        dossier_id: dossierId,
        titre: titre.trim(),
        intervenant_id: assignedAgentId,
        etat: "EN_COURS",
        observations: observations ? observations.trim() : "",
        deadline: limitDate,
      },
    });

    await logActivity(
      req.session.userId,
      "CREATION_TACHE_RAPIDE",
      "Tache",
      tache.id
    );

    req.session.success_msg = `Tâche "${titre}" ajoutée pour ce dossier.`;
    res.redirect(`/dossiers/${dossierId}`);
  } catch (error) {
    console.error("Erreur tâche rapide :", error);
    req.session.error_msg = "Une erreur est survenue lors de la création.";
    res.redirect(`/dossiers/${dossierId}`);
  }
});

// POST /dossiers/:id/taches/:tacheId/modifier - Mettre à jour une tâche depuis le dossier
router.post("/dossiers/:id/taches/:tacheId/modifier", requireAuth, async (req: any, res: any) => {
  try {
    const dossierId = parseInt(req.params.id);
    const tacheId = parseInt(req.params.tacheId);
    const { delete_task, etat, titre, observations, intervenant_id } = req.body;

    const previousTask = await prisma.tache.findUnique({ where: { id: tacheId } });
    if (!previousTask) {
      return res.status(404).send("Tâche introuvable.");
    }

    // Suppression demandée
    if (delete_task === "yes") {
      await prisma.tache.delete({ where: { id: tacheId } });
      await logActivity(req.session.userId, "SUPPRESSION_TACHE", "Tache", tacheId);
      req.session.success_msg = "Tâche retirée du dossier.";
      return res.redirect(`/dossiers/${dossierId}`);
    }

    const updateData: any = {};
    if (etat) updateData.etat = etat;
    if (titre) updateData.titre = titre;
    if (observations !== undefined) updateData.observations = observations;
    if (intervenant_id !== undefined) {
      updateData.intervenant_id = intervenant_id ? parseInt(intervenant_id) : null;
    }

    await prisma.tache.update({
      where: { id: tacheId },
      data: updateData,
    });

    if (etat && previousTask.etat !== etat) {
      await prisma.activityLog.create({
        data: {
          user_id: req.session.userId,
          action: 'tache.status',
          entity: 'dossier',
          entity_id: String(dossierId),
          meta: JSON.stringify({
            titre: previousTask.titre,
            from: previousTask.etat,
            to: etat
          })
        }
      });
    }

    await logActivity(
      req.session.userId,
      `MODIFICATION_TACHE_${tacheId}`,
      "Tache",
      tacheId
    );

    req.session.success_msg = "Tâche d'expédition actualisée.";
    res.redirect(`/dossiers/${dossierId}`);
  } catch (error) {
    console.error("Erreur modif tâche dossier :", error);
    res.status(500).send("Erreur de traitement.");
  }
});

export default router;
