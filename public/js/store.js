// A student's study data lives in THIS browser (localStorage). Nothing leaves it except the notes text
// that is attached to an AI request.

const KEY = "studybuddy:v1";
export const MAX_TOTAL_NOTE_CHARS = 400_000;
export const NOTES_AI_CHARS = 60_000;

const empty = () => ({
  notes: [],
  topics: {},
  streak: { count: 0, best: 0, lastDay: null },
  cards: [],
  knownCards: [],
  recentQuestions: [],
  chat: [],
  totals: { answered: 0, firstTry: 0 },
});

function load() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return empty();
  }
}

let state = load();
const listeners = new Set();

function commit(next) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: keeps working for this visit */
  }
  listeners.forEach((l) => l());
}
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    state = load();
    listeners.forEach((l) => l());
  }
});

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const dayString = (d) => d.toLocaleDateString("en-CA");
const topicKey = (name) => name.trim().toLowerCase().slice(0, 60);

function bumpStreak(s) {
  const today = dayString(new Date());
  if (s.lastDay === today) return s;
  const yesterday = dayString(new Date(Date.now() - 86400000));
  const count = s.lastDay === yesterday ? s.count + 1 : 1;
  return { count, best: Math.max(s.best, count), lastDay: today };
}

export const study = {
  /** Derived values for rendering. */
  view() {
    const topics = Object.values(state.topics);
    const today = dayString(new Date());
    const yesterday = dayString(new Date(Date.now() - 86400000));
    return {
      ...state,
      weakTopics: topics.filter((t) => t.misses >= 2 && t.run < 3).sort((a, b) => b.misses - a.misses || b.lastAt - a.lastAt),
      masteredTopics: topics.filter((t) => t.run >= 3 && t.seen >= 3).sort((a, b) => b.lastAt - a.lastAt),
      currentStreak: state.streak.lastDay === today || state.streak.lastDay === yesterday ? state.streak.count : 0,
      notesText: state.notes.map((n) => `# ${n.title}\n${n.text}`).join("\n\n"),
      hasNotes: state.notes.length > 0,
    };
  },
  addNote({ title, text, source }) {
    text = text.trim();
    if (text.length < 20) return { ok: false, reason: "Add at least a couple of lines of notes." };
    const total = state.notes.reduce((n, d) => n + d.text.length, 0) + text.length;
    if (total > MAX_TOTAL_NOTE_CHARS) return { ok: false, reason: "That's more notes than this browser can hold. Remove an older note first." };
    const doc = { id: Math.random().toString(36).slice(2, 10), title: title.trim().slice(0, 80) || "Pasted notes", text, addedAt: Date.now(), source };
    commit({ ...state, notes: [...state.notes, doc] });
    return { ok: true };
  },
  removeNote(id) {
    commit({ ...state, notes: state.notes.filter((n) => n.id !== id) });
  },
  /** ok = right on the first try. Three right in a row clears a weak spot. */
  recordAnswer(topic, ok) {
    const key = topicKey(topic || "General");
    const prev = state.topics[key] ?? { name: (topic || "General").trim().slice(0, 60), seen: 0, correct: 0, misses: 0, run: 0, lastAt: 0 };
    const run = ok ? prev.run + 1 : 0;
    const next = { ...prev, seen: prev.seen + 1, correct: prev.correct + (ok ? 1 : 0), run, misses: ok ? (run >= 3 ? 0 : prev.misses) : prev.misses + 1, lastAt: Date.now() };
    commit({
      ...state,
      topics: { ...state.topics, [key]: next },
      streak: bumpStreak(state.streak),
      totals: { answered: state.totals.answered + 1, firstTry: state.totals.firstTry + (ok ? 1 : 0) },
    });
  },
  /** Counts toward the streak without scoring (e.g. an explain-it-back attempt). */
  recordActivity() {
    const streak = bumpStreak(state.streak);
    if (streak !== state.streak) commit({ ...state, streak });
  },
  setCards(cards) {
    commit({ ...state, cards, knownCards: [] });
  },
  markCard(id, known) {
    const set = new Set(state.knownCards);
    known ? set.add(id) : set.delete(id);
    commit({ ...state, knownCards: [...set] });
  },
  resetKnownCards() {
    commit({ ...state, knownCards: [] });
  },
  rememberQuestions(qs) {
    commit({ ...state, recentQuestions: [...state.recentQuestions, ...qs].slice(-30) });
  },
  setChat(chat) {
    commit({ ...state, chat: chat.slice(-40) });
  },
  resetProgress() {
    commit({ ...state, topics: {}, streak: empty().streak, totals: empty().totals, recentQuestions: [] });
  },
};

// A student who joined a class keeps a random token in this browser (no account, no email).
const CLASS_KEY = "studybuddy:class";
let session = (() => {
  try {
    return JSON.parse(localStorage.getItem(CLASS_KEY) ?? "null");
  } catch {
    return null;
  }
})();
const sessionListeners = new Set();
export const classSession = {
  get: () => session,
  set(s) {
    session = s;
    try {
      localStorage.setItem(CLASS_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
    sessionListeners.forEach((l) => l());
  },
  clear() {
    session = null;
    try {
      localStorage.removeItem(CLASS_KEY);
    } catch {
      /* ignore */
    }
    sessionListeners.forEach((l) => l());
  },
  subscribe(fn) {
    sessionListeners.add(fn);
    return () => sessionListeners.delete(fn);
  },
};
