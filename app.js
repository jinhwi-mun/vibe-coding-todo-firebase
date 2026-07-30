import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js";
import {
  getDatabase,
  ref,
  push,
  set,
  get,
  onValue,
  update,
  remove,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCD588KdnefpRy1bIa49mCnkEF14kDnWuw",
  authDomain: "jinhwi-todo-backend.firebaseapp.com",
  projectId: "jinhwi-todo-backend",
  storageBucket: "jinhwi-todo-backend.firebasestorage.app",
  messagingSenderId: "1093050709908",
  appId: "1:1093050709908:web:0bf8b77a11de8129dcc181",
  measurementId: "G-XEZFNXD4RC",
  databaseURL: "https://jinhwi-todo-backend-default-rtdb.firebaseio.com",
};

const app = initializeApp(firebaseConfig);
getAnalytics(app);
const db = getDatabase(app);

const TASKS_PATH = "tasks";
const DDAY_ID = "dday";

const QUADRANT_IDS = [
  "urgent-important",
  "important-not-urgent",
  "urgent-not-important",
  "future",
  DDAY_ID,
];

/** @type {Record<string, object[]>} */
let state = emptyState();

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
          };
        }

        return {
          id,
          text: typeof task.text === "string" ? task.text : "",
          done: Boolean(task.done),
          createdAt: typeof task.createdAt === "number" ? task.createdAt : 0,
        };
      })
      .sort((a, b) => {
        if (quadrantId === DDAY_ID) {
          return String(a.date).localeCompare(String(b.date)) || a.createdAt - b.createdAt;
        }
        return a.createdAt - b.createdAt;
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
  });

  const ddaySection = document.querySelector(`[data-quadrant="${DDAY_ID}"]`);
  if (ddaySection) {
    const list = ddaySection.querySelector(".dday-list");
    list.replaceChildren();
    for (const item of state[DDAY_ID] || []) {
      list.appendChild(createDdayElement(item));
    }
  }
}

function createTaskElement(quadrantId, task) {
  const template = document.getElementById("task-item-template");
  const node = template.content.firstElementChild.cloneNode(true);

  const check = node.querySelector(".task-check");
  const textEl = node.querySelector(".task-text");
  const editInput = node.querySelector(".task-edit");
  const editBtn = node.querySelector(".edit-btn");
  const deleteBtn = node.querySelector(".delete-btn");

  check.checked = task.done;
  textEl.textContent = task.text;
  editInput.value = task.text;
  node.classList.toggle("is-done", task.done);

  check.addEventListener("change", async () => {
    try {
      await updateTask(quadrantId, task.id, { done: check.checked });
    } catch (err) {
      check.checked = !check.checked;
      reportFirebaseError(err);
    }
  });

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

  return node;
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

  const newTaskRef = push(quadrantRef(quadrantId));
  await set(newTaskRef, {
    text: trimmed,
    done: false,
    createdAt: Date.now(),
    ...extra,
  });
}

/** Firebase에 D-day 추가 */
async function addDday(text, date) {
  const trimmed = text.trim();
  const normalized = normalizeDate(date);
  if (!trimmed || !normalized) return false;

  const newTaskRef = push(quadrantRef(DDAY_ID));
  await set(newTaskRef, {
    text: trimmed,
    date: normalized,
    createdAt: Date.now(),
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

function reportFirebaseError(err) {
  console.error(err);
  alert("Could not sync with Firebase. Check your Realtime Database rules and connection.");
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

fetchTasks()
  .then(() => subscribeTasks())
  .catch((err) => reportFirebaseError(err));
