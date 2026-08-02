import { bindSortableList } from "./sortable.js";

const DAILY_GOALS_PATH = "dailyGoals";
const TREE_MIN_DONE = 6;

const STAGE_META = {
  seed: { label: "seed · 0 done" },
  sprout: { label: "sprout · 1 done" },
  young: { label: "young plant · 2–3 done" },
  large: { label: "large plant · 4–5 done" },
  tree: { label: "tree · all done!" },
};

const STAGE_SVG = {
  seed: `
    <circle cx="60" cy="72" r="5" fill="#6b4423"/>
    <circle cx="60" cy="72" r="2.5" fill="#8b5a2b"/>
  `,
  sprout: `
    <path d="M60 76 L60 52" stroke="#5a8f3a" stroke-width="3" stroke-linecap="round" fill="none"/>
    <ellipse cx="50" cy="50" rx="10" ry="6" fill="#7cb342" transform="rotate(-25 50 50)"/>
    <ellipse cx="70" cy="50" rx="10" ry="6" fill="#8bc34a" transform="rotate(25 70 50)"/>
  `,
  young: `
    <path d="M60 78 L60 42" stroke="#6b4f2a" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <polygon points="60,30 52,46 68,46" fill="#7cb342"/>
    <polygon points="48,48 40,60 56,56" fill="#8bc34a"/>
    <polygon points="72,46 66,58 80,58" fill="#9ccc65"/>
    <polygon points="58,52 50,64 66,62" fill="#7cb342"/>
  `,
  large: `
    <path d="M60 80 L60 48" stroke="#6b4f2a" stroke-width="5" stroke-linecap="round" fill="none"/>
    <ellipse cx="60" cy="40" rx="16" ry="14" fill="#7cb342"/>
    <ellipse cx="48" cy="48" rx="11" ry="9" fill="#8bc34a"/>
    <ellipse cx="72" cy="46" rx="12" ry="10" fill="#9ccc65"/>
    <circle cx="54" cy="36" r="1.6" fill="#e8f5e9"/>
    <circle cx="66" cy="42" r="1.4" fill="#e8f5e9"/>
    <circle cx="60" cy="48" r="1.3" fill="#e8f5e9"/>
  `,
  tree: `
    <path d="M44 80 Q60 72 76 80 L72 86 Q60 78 48 86 Z" fill="#8d6e4c"/>
    <ellipse cx="60" cy="78" rx="14" ry="8" fill="#6b4f2a"/>
    <path d="M48 78 Q60 40 72 78" fill="#a1887f"/>
    <path d="M52 78 Q60 48 68 78" fill="#8d6e63"/>
    <ellipse cx="60" cy="36" rx="14" ry="11" fill="#7cb342"/>
    <ellipse cx="46" cy="44" rx="12" ry="10" fill="#8bc34a"/>
    <ellipse cx="74" cy="44" rx="12" ry="10" fill="#9ccc65"/>
    <ellipse cx="54" cy="50" rx="9" ry="7" fill="#7cb342"/>
    <ellipse cx="68" cy="52" rx="8" ry="6" fill="#8bc34a"/>
    <circle cx="56" cy="32" r="1.5" fill="#f1f8e9"/>
    <circle cx="64" cy="38" r="1.3" fill="#f1f8e9"/>
    <circle cx="48" cy="42" r="1.2" fill="#f1f8e9"/>
    <circle cx="72" cy="46" r="1.4" fill="#f1f8e9"/>
  `,
};

/**
 * @param {{
 *   db: any,
 *   ref: Function,
 *   push: Function,
 *   set: Function,
 *   onValue: Function,
 *   update: Function,
 *   remove: Function,
 *   reportFirebaseError: Function,
 * }} api
 */
export function initGarden(api) {
  const { db, ref, push, set, onValue, update, remove, reportFirebaseError } = api;

  /** @type {{ id: string, text: string, done: boolean, createdAt: number }[]} */
  let goals = [];
  const todayKey = toDateKey(new Date());

  function toDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function goalsRef() {
    return ref(db, `${DAILY_GOALS_PATH}/${todayKey}`);
  }

  function goalRef(id) {
    return ref(db, `${DAILY_GOALS_PATH}/${todayKey}/${id}`);
  }

  function getStage(doneCount, total) {
    if (total > 0 && doneCount >= total) return "tree";
    if (doneCount >= TREE_MIN_DONE) return "tree";
    if (doneCount >= 4) return "large";
    if (doneCount >= 2) return "young";
    if (doneCount >= 1) return "sprout";
    return "seed";
  }

  function updatePlant() {
    const total = goals.length;
    const done = goals.filter((g) => g.done).length;
    const stage = getStage(done, total);

    const growth = document.getElementById("plant-growth");
    const stageEl = document.getElementById("plant-stage");
    const label = document.getElementById("plant-label");
    const ring = document.getElementById("plant-ring-fill");

    if (growth) growth.innerHTML = STAGE_SVG[stage];
    if (stageEl) stageEl.dataset.stage = stage;
    if (label) {
      label.textContent =
        total === 0
          ? "seed · add a goal"
          : stage === "tree" && done >= total && total > 0
            ? `tree · ${done}/${total} done`
            : `${STAGE_META[stage].label.split(" · ")[0]} · ${done}/${total}`;
    }

    if (ring) {
      const circumference = 2 * Math.PI * 56;
      const progress = total === 0 ? 0 : done / total;
      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference * (1 - progress));
    }
  }

  function renderGoals() {
    const list = document.getElementById("goals-list");
    const template = document.getElementById("goal-item-template");
    if (!list || !template) return;

    list.replaceChildren();
    for (const goal of goals) {
      const node = template.content.firstElementChild.cloneNode(true);
      node.dataset.id = goal.id;
      const check = node.querySelector(".goal-check");
      const text = node.querySelector(".goal-text");
      const del = node.querySelector(".goal-delete");

      check.checked = goal.done;
      text.textContent = goal.text;
      node.classList.toggle("is-done", goal.done);

      check.addEventListener("change", async () => {
        try {
          await update(goalRef(goal.id), { done: check.checked });
        } catch (err) {
          check.checked = !check.checked;
          reportFirebaseError(err);
        }
      });

      del.addEventListener("click", async () => {
        try {
          await remove(goalRef(goal.id));
        } catch (err) {
          reportFirebaseError(err);
        }
      });

      list.appendChild(node);
    }

    bindSortableList(list, {
      getId: (el) => el.dataset.id,
      reportError: reportFirebaseError,
      onReorder: async (orderedIds) => {
        const byId = Object.fromEntries(goals.map((g) => [g.id, g]));
        goals = orderedIds.map((id, index) => ({ ...byId[id], order: index }));
        renderGoals();
        const updates = {};
        orderedIds.forEach((id, index) => {
          updates[`${DAILY_GOALS_PATH}/${todayKey}/${id}/order`] = index;
        });
        await update(ref(db), updates);
      },
    });

    updatePlant();
  }

  document.getElementById("goals-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.currentTarget.querySelector(".goals-input");
    const text = input.value.trim();
    if (!text) return;

    try {
      const now = Date.now();
      const newRef = push(goalsRef());
      await set(newRef, {
        text,
        done: false,
        createdAt: now,
        order: now,
      });
      input.value = "";
      input.focus();
    } catch (err) {
      reportFirebaseError(err);
    }
  });

  onValue(
    goalsRef(),
    (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        goals = [];
      } else {
        goals = Object.entries(data)
          .map(([id, g]) => ({
            id,
            text: typeof g.text === "string" ? g.text : "",
            done: Boolean(g.done),
            createdAt: typeof g.createdAt === "number" ? g.createdAt : 0,
            order: typeof g.order === "number" ? g.order : null,
          }))
          .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
      }
      renderGoals();
    },
    (error) => reportFirebaseError(error)
  );

  updatePlant();
}
