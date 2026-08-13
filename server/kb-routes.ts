import { Router, Request, Response } from "express";
import { storage } from "./storage";
import { getUserRole, isAdminRole } from "./password-policy";

function requireAdmin(req: Request, res: Response, next: Function) {
  const user = req.user;
  if (!user || !isAdminRole(getUserRole(user.email))) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

export function registerKbRoutes(app: any, authMiddleware: Function) {
  app.get("/api/kb/export", async (_req: Request, res: Response) => {
    try {
      const prompts = await storage.kbPrompts.list();
      const result = await Promise.all(prompts.map(async (p: any) => {
        const skills = await storage.kbPromptSkills.getByPrompt(p.id);
        return { ...p, skills };
      }));
      res.json(result);
    } catch (error) {
      console.error("KB export error:", error);
      res.status(500).json({ error: "Failed to export knowledge base" });
    }
  });

  app.get("/api/kb/prompts", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { q, category } = req.query;
      let results = await storage.kbPrompts.list();

      if (q && typeof q === "string") {
        const search = q.toLowerCase();
        results = results.filter(p => 
          p.title.toLowerCase().includes(search) ||
          p.problemDescription.toLowerCase().includes(search) ||
          (p.category && p.category.toLowerCase().includes(search))
        );
      }

      if (category && typeof category === "string") {
        results = results.filter(p => p.category === category);
      }

      res.json(results);
    } catch (error) {
      console.error("KB list prompts error:", error);
      res.status(500).json({ error: "Failed to fetch prompts" });
    }
  });

  app.get("/api/kb/prompts/:id", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const prompt = await storage.kbPrompts.get(id);
      if (!prompt) return res.status(404).json({ error: "Prompt not found" });

      const skills = await storage.kbPromptSkills.getByPrompt(id);
      res.json({ ...prompt, skills });
    } catch (error) {
      console.error("KB get prompt error:", error);
      res.status(500).json({ error: "Failed to fetch prompt" });
    }
  });

  app.post("/api/kb/prompts", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, category, problemDescription, investigationSteps, idealEndState, tags, sourceTaskRef } = req.body;
      if (!title || !problemDescription || !investigationSteps || !idealEndState) {
        return res.status(400).json({ error: "Title, problem description, investigation steps, and ideal end state are required" });
      }
      if (title.length > 200) return res.status(400).json({ error: "Title is too long (max 200 characters)." });
      if (problemDescription.length > 5000) return res.status(400).json({ error: "Problem description is too long (max 5,000 characters)." });
      if (investigationSteps.length > 5000) return res.status(400).json({ error: "Investigation steps is too long (max 5,000 characters)." });
      if (idealEndState.length > 5000) return res.status(400).json({ error: "Ideal end state is too long (max 5,000 characters)." });

      const prompt = await storage.kbPrompts.create({
        id: "",
        title: title.slice(0, 200),
        category: (category || "general").slice(0, 100),
        problemDescription: problemDescription.slice(0, 5000),
        investigationSteps: investigationSteps.slice(0, 5000),
        idealEndState: idealEndState.slice(0, 5000),
        tags: tags || [],
        sourceTaskRef: sourceTaskRef || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      res.status(201).json(prompt);
    } catch (error) {
      console.error("KB create prompt error:", error);
      res.status(500).json({ error: "Failed to create prompt" });
    }
  });

  app.put("/api/kb/prompts/:id", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const { title, category, problemDescription, investigationSteps, idealEndState, tags, sourceTaskRef } = req.body;

      if (title && typeof title === "string" && title.length > 200) return res.status(400).json({ error: "Title is too long (max 200 characters)." });
      if (problemDescription && typeof problemDescription === "string" && problemDescription.length > 5000) return res.status(400).json({ error: "Problem description is too long (max 5,000 characters)." });
      if (investigationSteps && typeof investigationSteps === "string" && investigationSteps.length > 5000) return res.status(400).json({ error: "Investigation steps is too long (max 5,000 characters)." });
      if (idealEndState && typeof idealEndState === "string" && idealEndState.length > 5000) return res.status(400).json({ error: "Ideal end state is too long (max 5,000 characters)." });

      const updates: Record<string, any> = {};
      if (title !== undefined) updates.title = typeof title === "string" ? title.slice(0, 200) : title;
      if (category !== undefined) updates.category = typeof category === "string" ? category.slice(0, 100) : category;
      if (problemDescription !== undefined) updates.problemDescription = typeof problemDescription === "string" ? problemDescription.slice(0, 5000) : problemDescription;
      if (investigationSteps !== undefined) updates.investigationSteps = typeof investigationSteps === "string" ? investigationSteps.slice(0, 5000) : investigationSteps;
      if (idealEndState !== undefined) updates.idealEndState = typeof idealEndState === "string" ? idealEndState.slice(0, 5000) : idealEndState;
      if (tags !== undefined) updates.tags = tags;
      if (sourceTaskRef !== undefined) updates.sourceTaskRef = sourceTaskRef;

      const prompt = await storage.kbPrompts.update(id, updates);
      if (!prompt) return res.status(404).json({ error: "Prompt not found" });
      res.json(prompt);
    } catch (error) {
      console.error("KB update prompt error:", error);
      res.status(500).json({ error: "Failed to update prompt" });
    }
  });

  app.delete("/api/kb/prompts/:id", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const success = await storage.kbPrompts.delete(id);
      if (!success) return res.status(404).json({ error: "Prompt not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("KB delete prompt error:", error);
      res.status(500).json({ error: "Failed to delete prompt" });
    }
  });

  app.get("/api/kb/prompts/:id/skills", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const skills = await storage.kbPromptSkills.getByPrompt(id);
      res.json(skills);
    } catch (error) {
      console.error("KB list skills error:", error);
      res.status(500).json({ error: "Failed to fetch skills" });
    }
  });

  app.post("/api/kb/prompts/:id/skills", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const { title, skillName, skillContent } = req.body;
      if (!skillName || !skillContent) {
        return res.status(400).json({ error: "Skill name and content are required" });
      }
      if (typeof skillName === "string" && skillName.length > 200) {
        return res.status(400).json({ error: "Skill name is too long (max 200 characters)." });
      }
      if (typeof skillContent === "string" && skillContent.length > 10000) {
        return res.status(400).json({ error: "Skill content is too long (max 10,000 characters)." });
      }

      const prompt = await storage.kbPrompts.get(id);
      if (!prompt) return res.status(404).json({ error: "Prompt not found" });

      const skill = await storage.kbPromptSkills.create({
        id: "",
        promptId: id,
        title: typeof title === "string" ? title.slice(0, 200) : "",
        skillName: skillName.slice(0, 200),
        skillContent: skillContent.slice(0, 10000),
        createdAt: new Date().toISOString()
      });

      res.status(201).json(skill);
    } catch (error) {
      console.error("KB create skill error:", error);
      res.status(500).json({ error: "Failed to create skill" });
    }
  });

  app.put("/api/kb/skills/:id", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const { title, skillName, skillContent } = req.body;

      if (skillName && typeof skillName === "string" && skillName.length > 200) {
        return res.status(400).json({ error: "Skill name is too long (max 200 characters)." });
      }
      if (skillContent && typeof skillContent === "string" && skillContent.length > 10000) {
        return res.status(400).json({ error: "Skill content is too long (max 10,000 characters)." });
      }

      const updates: Record<string, any> = {};
      if (title !== undefined) updates.title = typeof title === "string" ? title.slice(0, 200) : title;
      if (skillName !== undefined) updates.skillName = typeof skillName === "string" ? skillName.slice(0, 200) : skillName;
      if (skillContent !== undefined) updates.skillContent = typeof skillContent === "string" ? skillContent.slice(0, 10000) : skillContent;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No updates provided" });
      }

      const skill = await storage.kbPromptSkills.update(id, updates);
      if (!skill) return res.status(404).json({ error: "Skill not found" });
      res.json(skill);
    } catch (error) {
      console.error("KB update skill error:", error);
      res.status(500).json({ error: "Failed to update skill" });
    }
  });

  app.delete("/api/kb/skills/:id", authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const success = await storage.kbPromptSkills.delete(id);
      if (!success) return res.status(404).json({ error: "Skill not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("KB delete skill error:", error);
      res.status(500).json({ error: "Failed to delete skill" });
    }
  });

  app.get("/api/kb/task-log", authMiddleware, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const prompts = await storage.kbPrompts.list();
      const result = await Promise.all(prompts.map(async (p: any) => {
        const skills = await storage.kbPromptSkills.getByPrompt(p.id);
        return { ...p, skills };
      }));
      // Sort by sourceTaskRef
      result.sort((a, b) => {
        const refA = a.sourceTaskRef || "";
        const refB = b.sourceTaskRef || "";
        return refA.localeCompare(refB);
      });
      res.json(result);
    } catch (error) {
      console.error("KB task-log error:", error);
      res.status(500).json({ error: "Failed to fetch task log" });
    }
  });

  app.get("/api/kb/categories", authMiddleware, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const prompts = await storage.kbPrompts.list();
      const categories = Array.from(new Set(prompts.map((p: any) => p.category || "general").filter(Boolean)));
      categories.sort();
      res.json(categories);
    } catch (error) {
      console.error("KB categories error:", error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });
}
