import {
  db,
  ref,
  push,
  set,
  get,
  onValue,
  update,
  remove,
  reportFirebaseError,
} from "./firebase.js";
import { initGarden } from "./garden.js";
import { bindSortableList } from "./sortable.js";

const TASKS_PATH = "tasks";
const PROGRESS_PATH = "progressLogs";
const DDAY_ID = "dday";

const MATRIX_IDS = [
  "urgent-important",
  "important-not-urgent",
  "urgent-not-important",
  "future",
];

const QUADRANT_IDS = [...MATRIX_IDS, DDAY_ID];

/** @type {Record<string, object[]>} */
let state = emptyState();

/** @type {Record<string, { id: string, note: string, percent: number, createdAt: number }[]>} */
let progressLogs = Object.fromEntries(MATRIX_IDS.map((id) => [id, []]));

function emptyState() {
  return Object.fromEntries(QUADRANT_IDS.map((id) => [id, []]));
}

function taskRef(quadrantId, taskId) {
  return ref(db, `${TASKS_PATH}/${quadrantId}/${taskId}`);
}

function quadrantRef(quadrantId) {
  return ref(db, `${TASKS_PATH}/${quadrantId}`);
}

function formatDdayLabel(dateStr) {
  const date = normalizeDate(dateStr);
  if (!date) return "—";

  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diff === 0) return "D-Day";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

/** Accepts yyyy-mm-dd (also light cleanup for spaces / slashes). */
function normalizeDate(value) {
  if (!value || typeof value !== "string") return "";
  const cleaned = value.trim().replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return "";

  const [y, m, d] = cleaned.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return "";
  }
  return cleaned;
}

function snapshotToState(snapshot) {
  const base = emptyState();
  const data = snapshot.val();
  if (!data) return base;

  for (const quadrantId of QUADRANT_IDS) {
    const quadrantTasks = data[quadrantId];
    if (!quadrantTasks || typeof quadrantTasks !== "object") continue;

    base[quadrantId] = Object.entries(quadrantTasks)
      .map(([id, task]) => {
        if (quadrantId === DDAY_ID) {
          return {
            id,
            text: typeof task.text === "string" ? task.text : "",
            date: typeof task.date === "string" ? task.date : "",
            createdAt: typeof task.createdAt === "number" ? task.createdAt : 0,
            order: typeof task.order === "number" ? task.order : null,
          };
        }

        return {
          id,
          text: typeof task.text === "string" ? task.text : "",
          done: Boolean(task.done),
          createdAt: typeof task.createdAt === "number" ? task.createdAt : 0,
          order: typeof task.order === "number" ? task.order : null,
        };
      })
      .sort((a, b) => {
        if (quadrantId === DDAY_ID) {
          const ao = a.order ?? a.createdAt;
          const bo = b.order ?? b.createdAt;
          return ao - bo || a.createdAt - b.createdAt;
        }
        const ao = a.order ?? a.createdAt;
        const bo = b.order ?? b.createdAt;
        return ao - bo || a.createdAt - b.createdAt;
      });
  }

  return base;
}

function renderAll() {
  document.querySelectorAll(".quadrant").forEach((section) => {
    const quadrantId = section.dataset.quadrant;
    const list = section.querySelector(".task-list");
    list.replaceChildren();
    for (const task of state[quadrantId] || []) {
      list.appendChild(createTaskElement(quadrantId, task));
    }
    enableListDropZone(list, quadrantId);
    updateProgressUI(quadrantId);
  });

  const ddaySection = document.querySelector(`[data-quadrant="${DDAY_ID}"]`);
  if (ddaySection) {
    const list = ddaySection.querySelector(".dday-list");
    list.replaceChildren();
    for (const item of state[DDAY_ID] || []) {
      list.appendChild(createDdayElement(item));
    }
    bindSortableList(list, {
      getId: (el) => el.dataset.id,
      reportError: reportFirebaseError,
      onReorder: async (orderedIds) => {
        const byId = Object.fromEntries((state[DDAY_ID] || []).map((t) => [t.id, t]));
        state[DDAY_ID] = orderedIds.map((id, index) => ({
          ...byId[id],
          order: index,
        }));
        renderAll();
        const updates = {};
        orderedIds.forEach((id, index) => {
          updates[`${TASKS_PATH}/${DDAY_ID}/${id}/order`] = index;
        });
        await update(ref(db), updates);
      },
    });
  }
}

function getProgressStats(quadrantId) {
  const tasks = state[quadrantId] || [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}

function formatLogTime(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function updateProgressUI(quadrantId) {
  const { total, done, percent } = getProgressStats(quadrantId);
  const badge = document.querySelector(`[data-progress-for="${quadrantId}"]`);
  const panel = document.querySelector(`[data-progress-panel="${quadrantId}"]`);
  if (!badge || !panel) return;

  const valueEl = badge.querySelector(".progress-value");
  valueEl.textContent = `${percent}%`;
  badge.classList.toggle("is-complete", percent === 100 && total > 0);
  badge.title = total === 0 ? "no tasks yet" : `${done} of ${total} done`;

  const summary = panel.querySelector(".progress-summary");
  summary.textContent =
    total === 0
      ? "no tasks yet · add a log below"
      : `${done} of ${total} done · ${percent}%`;

  const logList = panel.querySelector(".progress-log-list");
  logList.replaceChildren();
  for (const log of progressLogs[quadrantId] || []) {
    const li = document.createElement("li");
    li.className = "progress-log-item";
    li.innerHTML = `
      <div>
        <span class="progress-log-meta">${formatLogTime(log.createdAt)} · ${log.percent}%</span>
        <span class="progress-log-note"></span>
      </div>
      <button type="button" class="progress-log-delete" title="Delete">delete</button>
    `;
    li.querySelector(".progress-log-note").textContent = log.note;
    li.querySelector(".progress-log-delete").addEventListener("click", async () => {
      try {
        await remove(ref(db, `${PROGRESS_PATH}/${quadrantId}/${log.id}`));
      } catch (err) {
        reportFirebaseError(err);
      }
    });
    logList.appendChild(li);
  }
}

function createTaskElement(quadrantId, task) {
  const template = document.getElementById("task-item-template");
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.taskId = task.id;

  const textEl = node.querySelector(".task-text");
  const editInput = node.querySelector(".task-edit");
  const editBtn = node.querySelector(".edit-btn");
  const deleteBtn = node.querySelector(".delete-btn");

  textEl.textContent = task.text;
  editInput.value = task.text;
  node.classList.toggle("is-done", task.done);

  editBtn.addEventListener("click", () => startEdit(node, task, editInput));
  textEl.addEventListener("dblclick", () => startEdit(node, task, editInput));

  editInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishEdit(node, quadrantId, task, editInput);
    }
    if (e.key === "Escape") cancelEdit(node, task, editInput);
  });

  editInput.addEventListener("blur", () => {
    if (node.classList.contains("is-editing")) {
      finishEdit(node, quadrantId, task, editInput);
    }
  });

  deleteBtn.addEventListener("click", async () => {
    try {
      await deleteTask(quadrantId, task.id);
    } catch (err) {
      reportFirebaseError(err);
    }
  });

  enableTaskDrag(node, quadrantId);

  return node;
}

let dragState = null;

function clearDragIndicators() {
  document
    .querySelectorAll(".task-item.drag-over, .task-list.drag-over")
    .forEach((el) => el.classList.remove("drag-over"));
}

function enableTaskDrag(node, quadrantId) {
  node.addEventListener("dragstart", (e) => {
    if (node.classList.contains("is-editing")) {
      e.preventDefault();
      return;
    }
    if (e.target.closest("input, button, label, textarea, a")) {
      e.preventDefault();
      return;
    }

    dragState = { taskId: node.dataset.taskId, quadrantId };
    node.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.dataset.taskId);
  });

  node.addEventListener("dragend", () => {
    node.classList.remove("is-dragging");
    clearDragIndicators();
    dragState = null;
  });

  node.addEventListener("dragover", (e) => {
    if (!dragState || !MATRIX_IDS.includes(quadrantId)) return;
    if (dragState.taskId === node.dataset.taskId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    clearDragIndicators();
    node.classList.add("drag-over");
  });

  node.addEventListener("dragleave", () => {
    node.classList.remove("drag-over");
  });

  node.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove("drag-over");
    if (!dragState || !MATRIX_IDS.includes(quadrantId)) return;

    const fromId = dragState.taskId;
    const fromQuadrant = dragState.quadrantId;
    const toId = node.dataset.taskId;
    if (!fromId || !toId) return;
    if (fromQuadrant === quadrantId && fromId === toId) return;

    try {
      await placeTask(fromQuadrant, fromId, quadrantId, toId);
    } catch (err) {
      reportFirebaseError(err);
    }
  });
}

function enableListDropZone(list, quadrantId) {
  if (!MATRIX_IDS.includes(quadrantId) || list.dataset.dropBound === "1") return;
  list.dataset.dropBound = "1";

  list.addEventListener("dragover", (e) => {
    if (!dragState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!e.target.closest(".task-item")) {
      clearDragIndicators();
      list.classList.add("drag-over");
    }
  });

  list.addEventListener("dragleave", (e) => {
    if (!list.contains(e.relatedTarget)) {
      list.classList.remove("drag-over");
    }
  });

  list.addEventListener("drop", async (e) => {
    if (e.target.closest(".task-item")) return;
    e.preventDefault();
    list.classList.remove("drag-over");
    if (!dragState) return;

    try {
      await placeTask(dragState.quadrantId, dragState.taskId, quadrantId, null);
    } catch (err) {
      reportFirebaseError(err);
    }
  });
}

/**
 * Move/reorder a task. If beforeTaskId is null, append to the end of toQuadrant.
 */
async function placeTask(fromQuadrant, taskId, toQuadrant, beforeTaskId = null) {
  if (!MATRIX_IDS.includes(fromQuadrant) || !MATRIX_IDS.includes(toQuadrant)) return;

  const fromList = [...(state[fromQuadrant] || [])];
  const fromIndex = fromList.findIndex((t) => t.id === taskId);
  if (fromIndex < 0) return;

  const [moved] = fromList.splice(fromIndex, 1);
  const toList = fromQuadrant === toQuadrant ? fromList : [...(state[toQuadrant] || [])];

  let insertAt = toList.length;
  if (beforeTaskId) {
    const toIndex = toList.findIndex((t) => t.id === beforeTaskId);
    if (toIndex >= 0) insertAt = toIndex;
  }

  toList.splice(insertAt, 0, moved);

  const updates = {};

  if (fromQuadrant === toQuadrant) {
    state[fromQuadrant] = toList.map((t, i) => ({ ...t, order: i }));
    toList.forEach((t, i) => {
      updates[`${TASKS_PATH}/${fromQuadrant}/${t.id}/order`] = i;
    });
  } else {
    state[fromQuadrant] = fromList.map((t, i) => ({ ...t, order: i }));
    state[toQuadrant] = toList.map((t, i) => ({ ...t, order: i }));

    updates[`${TASKS_PATH}/${fromQuadrant}/${taskId}`] = null;
    updates[`${TASKS_PATH}/${toQuadrant}/${taskId}`] = {
      text: moved.text,
      done: Boolean(moved.done),
      createdAt: typeof moved.createdAt === "number" ? moved.createdAt : Date.now(),
      order: insertAt,
    };

    fromList.forEach((t, i) => {
      updates[`${TASKS_PATH}/${fromQuadrant}/${t.id}/order`] = i;
    });
    toList.forEach((t, i) => {
      if (t.id === taskId) return;
      updates[`${TASKS_PATH}/${toQuadrant}/${t.id}/order`] = i;
    });
  }

  renderAll();
  await update(ref(db), updates);
}

function bindDateField(input) {
  if (!input) return;
  const field = input.closest(".date-field");
  if (!field) return;

  const sync = () => {
    field.classList.toggle("has-value", Boolean(input.value));
  };

  sync();
  input.addEventListener("input", sync);
  input.addEventListener("change", sync);
}

function createDdayElement(item) {
  const template = document.getElementById("dday-item-template");
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;

  const badge = node.querySelector(".dday-badge");
  const textEl = node.querySelector(".dday-item-text");
  const editText = node.querySelector(".dday-edit-text");
  const editDate = node.querySelector(".dday-edit-date");
  const editBtn = node.querySelector(".edit-btn");
  const deleteBtn = node.querySelector(".delete-btn");

  badge.textContent = formatDdayLabel(item.date);
  textEl.textContent = item.text;
  editText.value = item.text;
  editDate.value = item.date;
  bindDateField(editDate);

  function startDdayEdit() {
    node.classList.add("is-editing");
    editText.value = item.text;
    editDate.value = item.date;
    editBtn.textContent = "save";
    editText.focus();
    editText.select();
  }

  async function finishDdayEdit() {
    if (!node.classList.contains("is-editing")) return;
    node.classList.remove("is-editing");
    editBtn.textContent = "edit";

    const text = editText.value.trim();
    const date = normalizeDate(editDate.value);

    try {
      if (!text) {
        await deleteTask(DDAY_ID, item.id);
        return;
      }

      if (!date) {
        alert("Please select a date.");
        node.classList.add("is-editing");
        editBtn.textContent = "save";
        editDate.focus();
        return;
      }

      if (text !== item.text || date !== item.date) {
        await updateTask(DDAY_ID, item.id, { text, date });
      }
    } catch (err) {
      reportFirebaseError(err);
    }
  }

  function cancelDdayEdit() {
    node.classList.remove("is-editing");
    editBtn.textContent = "edit";
    editText.value = item.text;
    editDate.value = item.date;
  }

  editBtn.addEventListener("click", () => {
    if (node.classList.contains("is-editing")) {
      finishDdayEdit();
    } else {
      startDdayEdit();
    }
  });

  textEl.addEventListener("dblclick", startDdayEdit);

  editText.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishDdayEdit();
    }
    if (e.key === "Escape") cancelDdayEdit();
  });

  editDate.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishDdayEdit();
    }
    if (e.key === "Escape") cancelDdayEdit();
  });

  deleteBtn.addEventListener("click", async () => {
    try {
      await deleteTask(DDAY_ID, item.id);
    } catch (err) {
      reportFirebaseError(err);
    }
  });

  return node;
}

function startEdit(node, task, editInput) {
  node.classList.add("is-editing");
  editInput.hidden = false;
  editInput.value = task.text;
  editInput.focus();
  editInput.select();
}

async function finishEdit(node, quadrantId, task, editInput) {
  if (!node.classList.contains("is-editing")) return;

  const trimmed = editInput.value.trim();
  node.classList.remove("is-editing");
  editInput.hidden = true;

  try {
    if (!trimmed) {
      await deleteTask(quadrantId, task.id);
      return;
    }

    if (trimmed !== task.text) {
      await updateTask(quadrantId, task.id, { text: trimmed });
    }
  } catch (err) {
    reportFirebaseError(err);
  }
}

function cancelEdit(node, task, editInput) {
  node.classList.remove("is-editing");
  editInput.hidden = true;
  editInput.value = task.text;
}

/** Firebase에 할 일 추가 */
async function addTask(quadrantId, text, extra = {}) {
  const trimmed = text.trim();
  if (!trimmed) return;

  const now = Date.now();
  const newTaskRef = push(quadrantRef(quadrantId));
  await set(newTaskRef, {
    text: trimmed,
    done: false,
    createdAt: now,
    order: now,
    ...extra,
  });
}

/** Firebase에 D-day 추가 */
async function addDday(text, date) {
  const trimmed = text.trim();
  const normalized = normalizeDate(date);
  if (!trimmed || !normalized) return false;

  const now = Date.now();
  const newTaskRef = push(quadrantRef(DDAY_ID));
  await set(newTaskRef, {
    text: trimmed,
    date: normalized,
    createdAt: now,
    order: now,
  });
  return true;
}

/** Firebase에서 할 일 수정 (텍스트 / 완료 여부 / 날짜) */
async function updateTask(quadrantId, taskId, changes) {
  await update(taskRef(quadrantId, taskId), changes);
}

/** Firebase에서 할 일 삭제 */
async function deleteTask(quadrantId, taskId) {
  await remove(taskRef(quadrantId, taskId));
}

function applyTasksSnapshot(snapshot) {
  state = snapshotToState(snapshot);
  renderAll();
}

/** 한 번 할 일 목록을 Firebase에서 가져옵니다. */
async function fetchTasks() {
  const snapshot = await get(ref(db, TASKS_PATH));
  applyTasksSnapshot(snapshot);
  return state;
}

/** 변경이 있을 때마다 목록을 다시 가져와 화면에 반영합니다. */
function subscribeTasks() {
  onValue(
    ref(db, TASKS_PATH),
    (snapshot) => {
      applyTasksSnapshot(snapshot);
    },
    (error) => {
      reportFirebaseError(error);
    }
  );
}

document.querySelectorAll(".quadrant .add-form").forEach((form) => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const section = form.closest(".quadrant");
    const quadrantId = section.dataset.quadrant;
    const input = form.querySelector(".add-input");
    const value = input.value;

    try {
      await addTask(quadrantId, value);
      input.value = "";
      input.focus();
    } catch (err) {
      reportFirebaseError(err);
    }
  });
});

document.querySelector(".dday-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const textInput = form.querySelector(".dday-text");
  const dateInput = form.querySelector(".dday-date");

  if (!normalizeDate(dateInput.value)) {
    alert("Please select a date.");
    dateInput.focus();
    return;
  }

  try {
    await addDday(textInput.value, dateInput.value);
    textInput.value = "";
    dateInput.value = "";
    dateInput.dispatchEvent(new Event("change"));
    textInput.focus();
  } catch (err) {
    reportFirebaseError(err);
  }
});

bindDateField(document.querySelector(".dday-form .dday-date"));

initGarden({
  db,
  ref,
  push,
  set,
  onValue,
  update,
  remove,
  reportFirebaseError,
});

document.querySelectorAll(".progress-badge").forEach((badge) => {
  badge.addEventListener("click", () => {
    const quadrantId = badge.dataset.progressFor;
    const panel = document.querySelector(`[data-progress-panel="${quadrantId}"]`);
    if (!panel) return;

    const willOpen = panel.hidden;
    document.querySelectorAll(".progress-panel").forEach((p) => {
      p.hidden = true;
    });
    document.querySelectorAll(".progress-badge").forEach((b) => {
      b.classList.remove("is-open");
    });

    if (willOpen) {
      panel.hidden = false;
      badge.classList.add("is-open");
      panel.querySelector(".progress-log-input")?.focus();
    }
  });
});

document.querySelectorAll(".progress-log-form").forEach((form) => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const panel = form.closest(".progress-panel");
    const quadrantId = panel?.dataset.progressPanel;
    const input = form.querySelector(".progress-log-input");
    const note = input.value.trim();
    if (!quadrantId || !note) return;

    const { percent } = getProgressStats(quadrantId);

    try {
      const newRef = push(ref(db, `${PROGRESS_PATH}/${quadrantId}`));
      await set(newRef, {
        note,
        percent,
        createdAt: Date.now(),
      });
      input.value = "";
      input.focus();
    } catch (err) {
      reportFirebaseError(err);
    }
  });
});

function subscribeProgressLogs() {
  onValue(
    ref(db, PROGRESS_PATH),
    (snapshot) => {
      const next = Object.fromEntries(MATRIX_IDS.map((id) => [id, []]));
      const data = snapshot.val();
      if (data) {
        for (const quadrantId of MATRIX_IDS) {
          const logs = data[quadrantId];
          if (!logs || typeof logs !== "object") continue;
          next[quadrantId] = Object.entries(logs)
            .map(([id, log]) => ({
              id,
              note: typeof log.note === "string" ? log.note : "",
              percent: typeof log.percent === "number" ? log.percent : 0,
              createdAt: typeof log.createdAt === "number" ? log.createdAt : 0,
            }))
            .sort((a, b) => b.createdAt - a.createdAt);
        }
      }
      progressLogs = next;
      for (const id of MATRIX_IDS) updateProgressUI(id);
    },
    (error) => reportFirebaseError(error)
  );
}

fetchTasks()
  .then(() => {
    subscribeTasks();
    subscribeProgressLogs();
  })
  .catch((err) => reportFirebaseError(err));
