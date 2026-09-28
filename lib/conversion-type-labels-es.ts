/**
 * Spanish labels for the conversion types in the CMS catalog
 * (`proset_cms.conversion_types`, edited through Mathesar).
 *
 * The SOURCE OF TRUTH for these strings is the Spanish block of `lib/i18n.tsx` —
 * that is the wording a Spanish user already sees in the app, so the catalog must
 * not invent its own. This file exists because `lib/i18n.tsx` pulls in React Native
 * and cannot be loaded from the Node-side seed script;
 * `tests/server/conversion-type-labels-es.test.ts` fails if the two ever drift.
 *
 * Not listed here: the six Saint Pack types, whose labels ride inline in
 * SAINT_PACK_CONVERSIONS inside `scripts/seed-mathesar-cms.ts`.
 */
export const CONVERSION_TYPE_LABELS_ES: Record<string, string> = {
  academic_research: "Investigación académica",
  action_items: "Puntos de acción",
  adhd_plan: "Plan (Estructurado)",
  argumentative_essay: "Ensayo argumentativo",
  bibliography: "Bibliografía",
  blog_post: "Post de blog",
  bullet_points: "Puntos clave",
  calendar_event: "Evento de calendario",
  course_syllabus: "Plan de curso",
  discussion_questions: "Preguntas de discusión",
  email: "Correo",
  essay_explainer: "Explicador de ensayos",
  flashcards: "Tarjetas de estudio (CSV)",
  freelancer_time_log: "Registro de horas",
  general_request: "Solicitud General",
  github_issue: "Issue de GitHub",
  lesson_plan: "Plan de lección",
  linkedin_post: "Post de LinkedIn",
  nonfiction_draft: "Borrador de no ficción",
  notes: "Notas",
  office_memo: "Memorándum",
  outline: "Esquema",
  podcast_script: "Guion de podcast",
  project_plan: "Plan de proyecto",
  prompt: "Prompt de IA",
  quick_research: "Investigación rápida",
  quiz: "Examen",
  reference_list: "Lista de referencias",
  requirements: "Requisitos",
  research_questions: "Diseño de preguntas de investigación",
  rubric: "Rúbrica de evaluación",
  scaffolded_action_items: "Tareas pendientes (Estructurado)",
  scaffolded_project_plan: "Plan de proyecto (Estructurado)",
  slide_deck: "Presentación de diapositivas",
  spreadsheet: "Hoja de cálculo",
  statistics: "Estadísticas",
  study_guide: "Guía de estudio",
  summary: "Resumen",
  text_message: "Mensaje de texto",
  todo_list: "Lista de pendientes",
  video_script: "Guion de video",
  white_paper: "Documento técnico",
};
