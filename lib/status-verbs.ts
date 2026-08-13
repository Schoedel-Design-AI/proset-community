export type StatusVerbSetId = "clarifying" | "thinking" | "making";

export interface StatusVerbSet {
  id: StatusVerbSetId;
  verbs: string[];
  verbsEs: string[];
}

// EN verbs from Barry's spec; ES verbs are equivalent gerunds.
export const STATUS_VERB_SETS: StatusVerbSet[] = [
  {
    id: "clarifying",
    verbs: [
      "Elucidating", "Illuminating", "Demystifying", "Explicating", "Untangling",
      "Unpacking", "Deciphering", "Simplifying", "Articulating", "Disambiguating",
      "Translating", "Distilling", "Defining", "Resolving", "Fleshing out",
      "Streamlining", "Interpreting", "Exposing", "Crystalizing", "Unraveling",
    ],
    verbsEs: [
      "Aclarando", "Iluminando", "Desmitificando", "Explicando", "Desenredando",
      "Desglosando", "Descifrando", "Simplificando", "Articulando", "Desambiguando",
      "Transmitiendo", "Destilando", "Definiendo", "Resolviendo", "Desarrollando",
      "Agilizando", "Interpretando", "Revelando", "Cristalizando", "Desentrañando",
    ],
  },
  {
    id: "thinking",
    verbs: [
      "Pondering", "Deliberating", "Contemplating", "Mulling", "Reflecting",
      "Ruminating", "Reasoning", "Cogitating", "Noodling", "Brainstorming",
      "Synthesizing", "Assessing", "Analyzing", "Evaluating", "Dissecting",
      "Formulating", "Processing", "Deducing", "Speculating", "Conceptualizing",
    ],
    verbsEs: [
      "Reflexionando", "Deliberando", "Contemplando", "Cavilando", "Meditando",
      "Rumiando", "Razonando", "Pensando", "Dándole vueltas", "Ideando",
      "Sintetizando", "Evaluando", "Analizando", "Valorando", "Diseccionando",
      "Formulando", "Procesando", "Deduciendo", "Especulando", "Conceptualizando",
    ],
  },
  {
    id: "making",
    verbs: [
      "Constructing", "Fabricating", "Formulating", "Crafting", "Engineering",
      "Generating", "Assembling", "Synthesizing", "Forging", "Creating",
      "Developing", "Producing", "Designing", "Composing", "Drafting",
      "Building", "Establishing", "Fashioning", "Authoring", "Originating",
    ],
    verbsEs: [
      "Construyendo", "Fabricando", "Elaborando", "Confeccionando", "Ingeniando",
      "Generando", "Ensamblando", "Sintetizando", "Forjando", "Creando",
      "Desarrollando", "Produciendo", "Diseñando", "Componiendo", "Redactando",
      "Armando", "Estableciendo", "Dando forma", "Escribiendo", "Originando",
    ],
  },
];

function randomUint32(): number {
  const rand = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(rand);
  } else {
    rand[0] = Math.floor(Math.random() * 0xffffffff);
  }
  return rand[0];
}

/** Fisher–Yates shuffle with crypto randomness. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomUint32() % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Per (set, language) rotation queues. Each queue holds a shuffled copy of
// the pool; picks pop from the front and refill (reshuffle) on exhaustion —
// guaranteeing every verb appears exactly once per cycle (fair rotation).
const rotationQueues = new Map<string, string[]>();

/** Test/observability helper: clear rotation state so a fresh cycle starts. */
export function resetStatusVerbRotation(): void {
  rotationQueues.clear();
}
function queueKey(setId: StatusVerbSetId, language: string): string {
  return `${setId}:${language}`;
}

function getRotationQueue(setId: StatusVerbSetId, language: string): string[] {
  const key = queueKey(setId, language);
  let queue = rotationQueues.get(key);
  if (!queue || queue.length === 0) {
    const set = STATUS_VERB_SETS.find((s) => s.id === setId);
    const pool = (set ? (language === "es" ? set.verbsEs : set.verbs) : []) as string[];
    queue = shuffle([...pool]);
    rotationQueues.set(key, queue);
  }
  return queue;
}

/** Pick the next verb with fair rotation: every verb appears exactly once per
 *  cycle, and the previously shown verb is never repeated across a refill
 *  boundary (unless it is the only option). */
export function pickRandomVerb(
  setId: StatusVerbSetId,
  language: string,
  exclude: string | null = null,
): string {
  const queue = getRotationQueue(setId, language);
  if (queue.length === 0) return "…";

  // At a refill boundary, the front may equal the just-shown verb — rotate
  // the head away so we never show the same verb twice in a row.
  if (exclude && queue.length > 1 && queue[0] === exclude) {
    queue.push(queue.shift()!);
  }
  return queue.shift()!;
}
