export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDate(dateStr: string, lang: "en" | "es" = "en"): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (lang === "es") {
    if (diffMins < 1) return "Ahora mismo";
    if (diffMins < 60) return `hace ${diffMins}m`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    if (diffDays < 7) return `hace ${diffDays}d`;
    return date.toLocaleDateString("es-MX", { month: "short", day: "numeric" });
  }

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export type ConversionCategory = "writing" | "productivity" | "research" | "academic";

export const CONVERSION_CATEGORIES: { key: ConversionCategory; labelKey: string }[] = [
  { key: "writing", labelKey: "category.writing" },
  { key: "productivity", labelKey: "category.productivity" },
  { key: "research", labelKey: "category.research" },
  { key: "academic", labelKey: "category.academic" },
];

export const MODULE_NAMES = {
  academic: "academic",
} as const;

export type ModuleName = typeof MODULE_NAMES[keyof typeof MODULE_NAMES];

export const MODULE_CONVERSION_TYPES: Record<ModuleName, string[]> = {
  academic: ["academic_research", "statistics", "argumentative_essay", "nonfiction_draft", "course_syllabus", "lesson_plan", "essay_explainer"],
};

export type ConversionComplexity = "simple" | "intermediate" | "advanced";

export const CONVERSION_COMPLEXITY_GROUPS: { key: ConversionComplexity; labelKey: string; icon: string }[] = [
  { key: "simple", labelKey: "complexity.simple", icon: "zap" },
  { key: "intermediate", labelKey: "complexity.intermediate", icon: "layers" },
  { key: "advanced", labelKey: "complexity.advanced", icon: "cpu" },
];

export const PACK_GROUPS: { moduleName: ModuleName; labelKey: string; icon: string; accent: string }[] = [
  { moduleName: "academic", labelKey: "category.academic", icon: "book-open", accent: "#34D399" },
];

export const CONVERSION_COMPLEXITY_MAP: Record<string, ConversionComplexity> = {
  // Simple — quick, single-step transforms
  bullet_points: "simple",
  notes: "simple",
  outline: "simple",
  questions: "simple",
  summary: "simple",
  todo_list: "simple",
  text_message: "simple",
  freelancer_time_log: "simple",
  quick_research: "simple",
  general_request: "simple",
  github_issue: "simple",
  // Intermediate — moderate complexity
  action_items: "intermediate",
  blog_post: "intermediate",
  calendar_event: "intermediate",
  email: "intermediate",
  linkedin_post: "intermediate",
  podcast_script: "intermediate",
  project_plan: "intermediate",
  adhd_plan: "intermediate",
  scaffolded_project_plan: "intermediate",
  scaffolded_action_items: "intermediate",
  requirements: "intermediate",
  video_script: "intermediate",
  office_memo: "intermediate",
  // Advanced — complex, specialised outputs
  prompt: "advanced",
  bibliography: "advanced",
  spreadsheet: "advanced",
  white_paper: "advanced",
  slide_deck: "advanced",
  // Academic Pack
  academic_research: "advanced",
  statistics: "intermediate",
  argumentative_essay: "intermediate",
  nonfiction_draft: "intermediate",
  course_syllabus: "advanced",
  lesson_plan: "intermediate",
  essay_explainer: "intermediate",
};

export type SubscriptionTier = "free" | "base" | "pro";
export type DisplayTier = SubscriptionTier;

export const TIER_CONVERSION_TYPES: Record<SubscriptionTier, string[]> = {
  free: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "general_request"],
  base: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "action_items", "questions", "prompt", "blog_post", "linkedin_post", "podcast_script", "project_plan", "calendar_event", "requirements", "bibliography", "spreadsheet", "video_script", "office_memo", "white_paper", "slide_deck", "general_request"],
  pro: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "action_items", "questions", "prompt", "blog_post", "linkedin_post", "podcast_script", "project_plan", "calendar_event", "requirements", "bibliography", "spreadsheet", "video_script", "office_memo", "white_paper", "slide_deck", "general_request"],
};

export const FREE_CONVERSION_TYPES = TIER_CONVERSION_TYPES.free;

export const TIER_DISPLAY_NAMES: Record<SubscriptionTier, string> = {
  free: "Free",
  base: "Base",
  pro: "Pro",
};

export function normalizeSubscriptionTier(value?: string | null): SubscriptionTier {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pro") return "pro";
  if (normalized === "free") return "free";
  if (normalized === "plus" || normalized === "cloud_plus" || normalized === "base") return "base";
  return normalized ? "base" : "free";
}

export function isPaidTier(tier: SubscriptionTier): boolean {
  return tier === "base" || tier === "pro";
}

export function getRequiredTierForConversionType(type: string): SubscriptionTier | null {
  const tiers: SubscriptionTier[] = ["free", "base", "pro"];
  for (const t of tiers) {
    if (TIER_CONVERSION_TYPES[t].includes(type)) {
      return t;
    }
  }
  return null;
}

export function isConversionTypeAvailable(type: string, userTier: SubscriptionTier): boolean {
  return TIER_CONVERSION_TYPES[userTier]?.includes(type) ?? false;
}

export const CONVERSION_TYPES: { value: string; label: string; icon: string; category: ConversionCategory; module?: ModuleName }[] = [
  // Writing
  { value: "email", label: "Email", icon: "mail", category: "writing" },
  { value: "blog_post", label: "Blog Post", icon: "edit-3", category: "writing" },
  { value: "linkedin_post", label: "LinkedIn Post", icon: "linkedin", category: "writing" },
  { value: "notes", label: "Notes", icon: "book", category: "writing" },
  { value: "summary", label: "Summary", icon: "file-text", category: "writing" },
  { value: "bullet_points", label: "Bullet Points", icon: "list", category: "writing" },
  { value: "outline", label: "Outline", icon: "align-left", category: "writing" },
  { value: "podcast_script", label: "Podcast Script", icon: "mic", category: "writing" },
  { value: "video_script", label: "Video Script", icon: "video", category: "writing" },
  { value: "text_message", label: "Text Message", icon: "message-circle", category: "writing" },
  { value: "general_request", label: "General Request", icon: "message-square", category: "writing" },
  { value: "office_memo", label: "Office Memo", icon: "file", category: "writing" },
  // Productivity
  { value: "todo_list", label: "To-Do List", icon: "check-square", category: "productivity" },
  { value: "action_items", label: "Action Items", icon: "check-circle", category: "productivity" },
  { value: "calendar_event", label: "Calendar Event", icon: "calendar", category: "productivity" },
  { value: "adhd_plan", label: "Plan (Scaffolded)", icon: "target", category: "productivity" },
  { value: "scaffolded_project_plan", label: "Project Plan (Scaffolded)", icon: "map", category: "productivity" },
  { value: "scaffolded_action_items", label: "Action Items (Scaffolded)", icon: "check-circle", category: "productivity" },
  { value: "project_plan", label: "Project Plan", icon: "map", category: "productivity" },
  { value: "requirements", label: "Requirements", icon: "clipboard", category: "productivity" },
  { value: "spreadsheet", label: "Spreadsheet", icon: "grid", category: "productivity" },
  { value: "github_issue", label: "Github Issue (Admin)", icon: "github", category: "productivity" },
  { value: "freelancer_time_log", label: "Work Time Log", icon: "clock", category: "productivity" },
  // Research
  { value: "quick_research", label: "Quick Research", icon: "search", category: "research" },
  { value: "bibliography", label: "Bibliography", icon: "bookmark", category: "research" },
  { value: "questions", label: "Questions", icon: "help-circle", category: "research" },
  { value: "prompt", label: "AI Prompt", icon: "zap", category: "research" },
  { value: "white_paper", label: "White Paper", icon: "award", category: "research" },
  { value: "slide_deck", label: "Slide Deck", icon: "monitor", category: "productivity" },
  // Academic Pack
  { value: "academic_research", label: "Academic Research (Asst.)", icon: "book-open", category: "academic", module: "academic" },
  { value: "statistics", label: "Statistics", icon: "bar-chart-2", category: "academic", module: "academic" },
  { value: "argumentative_essay", label: "Argumentative Essay", icon: "edit", category: "academic", module: "academic" },
  { value: "nonfiction_draft", label: "Non-Fiction Draft", icon: "file-text", category: "academic", module: "academic" },
  { value: "course_syllabus", label: "Course Syllabus", icon: "clipboard", category: "academic", module: "academic" },
  { value: "lesson_plan", label: "Lesson Plan", icon: "layout", category: "academic", module: "academic" },
  { value: "essay_explainer", label: "Essay Explainer", icon: "help-circle", category: "academic", module: "academic" },
];

export const CITATION_STYLES = [
  { value: "apa7", label: "APA 7th Edition", description: "Social sciences, education, psychology" },
  { value: "mla9", label: "MLA 9th Edition", description: "Humanities, English, literature" },
  { value: "chicago17", label: "Chicago / Turabian 17th Ed.", description: "History, some humanities" },
  { value: "ieee", label: "IEEE", description: "Engineering, computer science, technical" },
  { value: "asa", label: "ASA", description: "Sociology" },
  { value: "apsa", label: "APSA", description: "Political science, international relations" },
  { value: "ama", label: "AMA", description: "Medicine, nursing, biological sciences" },
  { value: "bluebook", label: "Bluebook", description: "Legal citation (US)" },
  { value: "acs", label: "ACS", description: "Chemistry" },
];

export const EXPORT_FORMATS = [
  { value: "txt", label: "Plain Text (.txt)", mimeType: "text/plain", ext: "txt" },
  { value: "md", label: "Markdown (.md)", mimeType: "text/markdown", ext: "md" },
  { value: "pdf", label: "PDF (.pdf)", mimeType: "application/pdf", ext: "pdf" },
  { value: "docx", label: "Word (.docx)", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  { value: "csv", label: "CSV (.csv)", mimeType: "text/csv", ext: "csv" },
  { value: "xlsx", label: "Excel Workbook (.xlsx)", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  { value: "sql", label: "SQL (.sql)", mimeType: "application/sql", ext: "sql" },
  { value: "ps1", label: "PowerShell (.ps1)", mimeType: "text/plain", ext: "ps1" },
  { value: "bat", label: "Batch File (.bat)", mimeType: "text/plain", ext: "bat" },
];
