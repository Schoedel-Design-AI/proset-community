import { Router, Request, Response } from "express";
import { storage } from "../../storage";
import { 
  parseSkillContent,
  serializeSkillContent,
  type SkillDefinition,
  type KnowledgebaseResource
} from "@shared/schema";
import { requireAuth } from "../../auth";
import { getRequiredRouteUserId, getRouteParam } from "../shared-utils";
import { 
  getUserModules, 
  getSelfServiceModulesForUser, 
  getSelfServiceModuleState,
} from "../../usage-service";
import { 
  CONVERSION_KNOWLEDGEBASES, 
  CONVERSION_PROMPTS, 
  CONVERSION_SKILLS 
} from "./prompts";
import {
  getUserConversionModelPreferences,
  normalizeModelPreferenceInput,
} from "./utils";
import {
  getConfiguredConversionModelCatalog,
  type UserConversionModelPreferences,
} from "../../conversion-model-routing";
import {
  getSelfServiceModuleCatalogEntry,
  type SelfServiceModuleState,
} from "@shared/self-service-modules";

const router = Router();

function serializeSelfServiceModule(module: SelfServiceModuleState) {
  const catalogEntry = getSelfServiceModuleCatalogEntry(module.moduleName);
  return {
    ...module,
    displayName: catalogEntry?.displayName || module.moduleName,
    conversionTypes: [...(catalogEntry?.conversionTypes || [])],
  };
}

// --- Routes ---

router.get("/default-prompts", async (_req: Request, res: Response) => {
  const filtered = { ...CONVERSION_PROMPTS };
  delete filtered.github_issue;
  res.json(filtered);
});

router.get("/default-skills", (_req: Request, res: Response) => {
  res.json(CONVERSION_SKILLS);
});

router.get("/default-knowledgebases", (_req: Request, res: Response) => {
  res.json(CONVERSION_KNOWLEDGEBASES);
});

// Model Preferences
router.get("/ai/models", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const preferences = await getUserConversionModelPreferences(userId);
    const catalog = getConfiguredConversionModelCatalog();
    res.json({
      regular: catalog.regular,
      advanced: catalog.advanced,
      defaults: catalog.defaults,
      current: preferences,
    });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your AI model options. Please try again." });
  }
});

router.put("/ai/model-preferences", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const catalog = getConfiguredConversionModelCatalog();
    const current = await getUserConversionModelPreferences(userId);

    const nextRegularModelId = normalizeModelPreferenceInput(req.body?.regularModelId);
    const nextAdvancedModelId = normalizeModelPreferenceInput(req.body?.advancedModelId);

    if (req.body?.regularModelId !== undefined && nextRegularModelId === undefined) {
      return res.status(400).json({ error: "That regular conversion model is not valid." });
    }
    if (req.body?.advancedModelId !== undefined && nextAdvancedModelId === undefined) {
      return res.status(400).json({ error: "That advanced conversion model is not valid." });
    }

    const merged: UserConversionModelPreferences = {
      regularModelId: nextRegularModelId === undefined ? current.regularModelId : nextRegularModelId,
      advancedModelId: nextAdvancedModelId === undefined ? current.advancedModelId : nextAdvancedModelId,
    };

    const availableRegularIds = new Set(catalog.regular.map((option) => option.id));
    const availableAdvancedIds = new Set(catalog.advanced.map((option) => option.id));

    if (merged.regularModelId && !availableRegularIds.has(merged.regularModelId)) {
      return res.status(400).json({ error: "That regular conversion model is not configured yet." });
    }
    if (merged.advancedModelId && !availableAdvancedIds.has(merged.advancedModelId)) {
      return res.status(400).json({ error: "That advanced conversion model is not configured yet." });
    }

    if (!merged.regularModelId && !merged.advancedModelId) {
      await storage.userAiModelPreferences.set(userId, null, null);
    } else {
      await storage.userAiModelPreferences.set(userId, merged.regularModelId || null, merged.advancedModelId || null);
    }

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble saving your AI model preferences. Please try again." });
  }
});

// Knowledgebases
router.get("/knowledgebases", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const rows = await storage.userKnowledgebases.getByUser(userId);
    const result: Record<string, KnowledgebaseResource[]> = {};
    for (const [key, value] of Object.entries(CONVERSION_KNOWLEDGEBASES)) {
      result[key] = value;
    }
    for (const row of rows) {
      try {
        result[row.conversionType] = JSON.parse(row.resources);
      } catch {}
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your knowledgebases. Please try again." });
  }
});

router.put("/knowledgebases/:type", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const type = req.params.type as string;
    if (!CONVERSION_PROMPTS[type] && !CONVERSION_KNOWLEDGEBASES[type]) {
      return res.status(400).json({ error: "That conversion type isn't available. Please choose a different one." });
    }
    const { resources } = req.body;
    if (!resources || !Array.isArray(resources)) {
      return res.status(400).json({ error: "Please add at least one resource link." });
    }
    if (resources.length > 10) {
      return res.status(400).json({ error: "You can add up to 10 resources per conversion type." });
    }
    for (const r of resources) {
      if (!r.title || !r.url || typeof r.title !== "string" || typeof r.url !== "string") {
        return res.status(400).json({ error: "Each resource needs both a title and a URL." });
      }
      if (r.title.length > 200) {
        return res.status(400).json({ error: "Resource title is too long (max 200 characters)." });
      }
      if (r.url.length > 500) {
        return res.status(400).json({ error: "Resource URL is too long (max 500 characters)." });
      }
      if (r.description && typeof r.description === "string" && r.description.length > 500) {
        return res.status(400).json({ error: "Resource description is too long (max 500 characters)." });
      }
    }
    const resourcesJson = JSON.stringify(resources);
    await storage.userKnowledgebases.update(userId, type, resourcesJson);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble saving your knowledgebase. Please try again." });
  }
});

router.delete("/knowledgebases/:type", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const type = req.params.type as string;
    if (!CONVERSION_PROMPTS[type] && !CONVERSION_KNOWLEDGEBASES[type]) {
      return res.status(400).json({ error: "That conversion type isn't available. Please choose a different one." });
    }
    await storage.userKnowledgebases.delete(userId, type);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble resetting your knowledgebase. Please try again." });
  }
});

// Skills
router.get("/skills", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const skills = await storage.userSkills.getByUser(userId);
    const result: Record<string, SkillDefinition> = {};
    for (const [key, value] of Object.entries(CONVERSION_SKILLS)) {
      result[key] = value;
    }
    for (const skill of skills) {
      result[skill.conversionType] = parseSkillContent(skill.skillContent);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your skills. Please try again." });
  }
});

router.put("/skills/:type", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const type = req.params.type as string;
    let skill = req.body.skill;
    if (!skill && typeof req.body.skillContent === "string") {
      skill = parseSkillContent(req.body.skillContent);
    }
    if (!skill || typeof skill !== "object") {
      return res.status(400).json({ error: "Please add some content for this skill." });
    }
    const skillDef: SkillDefinition = {
      voice: typeof skill.voice === "string" ? skill.voice.slice(0, 2000) : "",
      rules: Array.isArray(skill.rules) ? skill.rules.map((r: string) => typeof r === "string" ? r.slice(0, 500) : "").slice(0, 20) : [],
      outputExample: typeof skill.outputExample === "string" ? skill.outputExample.slice(0, 2000) : "",
      qualityCriteria: Array.isArray(skill.qualityCriteria) ? skill.qualityCriteria.map((c: string) => typeof c === "string" ? c.slice(0, 500) : "").slice(0, 20) : [],
    };
    const serialized = serializeSkillContent(skillDef);
    if (serialized.length > 10000) {
      return res.status(400).json({ error: "Skill definition is too large. Please shorten your voice, rules, or examples." });
    }
    await storage.userSkills.update(userId, type, serialized);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble saving your skill. Please try again." });
  }
});

router.delete("/skills/:type", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const type = req.params.type as string;
    await storage.userSkills.delete(userId, type);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble resetting your skill. Please try again." });
  }
});

// Learnings
router.get("/learnings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const learnings = await storage.userLearnings.getByUser(userId);
    res.json(learnings);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your learnings. Please try again." });
  }
});

router.put("/learnings/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const id = req.params.id as string;
    const insight = typeof req.body?.insight === "string" ? req.body.insight.trim() : "";
    if (!insight) {
      return res.status(400).json({ error: "Learning text is required." });
    }
    const learnings = await storage.userLearnings.getByUser(userId);
    const existing = learnings.find(l => l.id === id);
    if (!existing) {
      return res.status(404).json({ error: "Learning not found." });
    }

    const updated = await storage.userLearnings.update(id, { insight });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble updating that learning. Please try again." });
  }
});

router.delete("/learnings/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const id = req.params.id as string;
    const learnings = await storage.userLearnings.getByUser(userId);
    const existing = learnings.find(l => l.id === id);
    if (!existing) {
      return res.status(404).json({ error: "Learning not found." });
    }
    await storage.userLearnings.delete(id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble removing that learning. Please try again." });
  }
});

router.delete("/learnings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const learnings = await storage.userLearnings.getByUser(userId);
    await Promise.all(learnings.map(l => storage.userLearnings.delete(l.id)));
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble clearing your learnings. Please try again." });
  }
});

// --- Style Preferences ---

router.get("/style/preferences", requireAuth, async (req, res) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const conversionType = req.query.type as string | undefined;
    const allPrefs = await storage.stylePreferences.getByUser(userId);
    const sortedPrefs = allPrefs.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
    const filteredPrefs = conversionType 
      ? sortedPrefs.filter(p => p.conversionType === conversionType).slice(0, 10)
      : sortedPrefs.slice(0, 50);
    res.json(filteredPrefs);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your style preferences." });
  }
});

router.post("/style/preferences", requireAuth, async (req, res) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const { conversionType, feedback } = req.body;
    if (!conversionType || !feedback || !feedback.trim()) {
      return res.status(400).json({ error: "Conversion type and feedback are required" });
    }
    const trimmedFeedback = feedback.trim().slice(0, 500);
    const pref = await storage.stylePreferences.create({
      id: "",
      userId,
      conversionType,
      feedback: trimmedFeedback,
      createdAt: new Date().toISOString()
    });
    res.json(pref);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble saving that style preference." });
  }
});

router.delete("/style/preferences/:id", requireAuth, async (req, res) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const id = req.params.id as string;
    const allPrefs = await storage.stylePreferences.getByUser(userId);
    const existing = allPrefs.find(p => p.id === id);
    if (!existing) {
      return res.status(404).json({ error: "Style preference not found." });
    }
    await storage.stylePreferences.delete(id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble removing that style preference." });
  }
});

// --- Module Management ---

router.get("/user/modules", requireAuth, async (req, res) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const modules = await getUserModules(userId);
    res.json({ modules });
  } catch (error: any) {
    console.error("Get user modules error:", error);
    res.status(500).json({ error: "Could not load modules" });
  }
});

router.get("/modules/self", requireAuth, async (req, res) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const modules = await getSelfServiceModulesForUser(userId);
    res.json({
      modules: modules.map(serializeSelfServiceModule),
    });
  } catch (error: any) {
    console.error("Get self-service modules error:", error);
    res.status(500).json({ error: "Could not load module state" });
  }
});

router.put("/modules/self/:moduleName", requireAuth, async (req, res) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const moduleName = getRouteParam(req.params.moduleName, "module name");
    const enabled = req.body?.enabled;

    if (!getSelfServiceModuleCatalogEntry(moduleName)) {
      return res.status(404).json({ error: "module_not_found" });
    }
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const state = await getSelfServiceModuleState(userId, moduleName);
    if (!state) {
      return res.status(404).json({ error: "module_not_found" });
    }
    if (!state.eligible) {
      return res.status(403).json({ error: "module_plan_required", requiredTier: state.requiredTier, moduleName });
    }
    if (!state.userCanToggle) {
      return res.json({
        success: true,
        module: serializeSelfServiceModule(state),
      });
    }

    if (enabled) {
      await storage.userModules.assign(userId, moduleName, null, userId);
    } else {
      await storage.userModules.remove(userId, moduleName);
    }

    const refreshed = await getSelfServiceModuleState(userId, moduleName);
    res.json({
      success: true,
      module: refreshed ? serializeSelfServiceModule(refreshed) : null,
    });
  } catch (error: any) {
    console.error("Update self-service module error:", error);
    res.status(500).json({ error: "Could not update module state" });
  }
});

export default router;
