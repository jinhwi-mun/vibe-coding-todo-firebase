import { bindSortableList } from "./sortable.js";

const SCHEDULED_PATH = "scheduled";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * @param {object} api
 * @param {{ lockedView?: 'month'|'week'|'day', initialDate?: string }} [options]
 */
export function initSchedule(api, options = {}) {
  const { db, ref, push, set, onValue, update, remove, reportFirebaseError } = api;
  const lockedView = options.lockedView || null;

  /** @type {Record<string, { id: string, text: string, note: string, done: boolean, createdAt: number }[]>} */
  let scheduled = {};
  let currentView = lockedView || "month";
  let cursor = startOfDay(new Date());
  let selectedDate = toDateKey(cursor);

  if (options.initialDate && /^\d{4}-\d{2}-\d{2}$/.test(options.initialDate)) {
    cursor = fromDateKey(options.initialDate);
    selectedDate = options.initialDate;
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function toDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function fromDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatLongDate(key) {
    const d = fromDateKey(key);
    return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  function tasksFor(dateKey) {
    return scheduled[dateKey] || [];
  }

  function scheduledRef(dateKey, taskId) {
    return ref(db, `${SCHEDULED_PATH}/${dateKey}/${taskId}`);
  }

  function dayRef(dateKey) {
    return ref(db, `${SCHEDULED_PATH}/${dateKey}`);
  }

  function parseScheduled(snapshot) {
    const next = {};
    const data = snapshot.val();
    if (!data) return next;

    for (const [dateKey, tasks] of Object.entries(data)) {
      if (!tasks || typeof tasks !== "object") continue;
      next[dateKey] = Object.entries(tasks)
        .map(([id, task]) => ({
          id,
          text: typeof task.text === "string" ? task.text : "",
          note: typeof task.note === "string" ? task.note : "",
          done: Boolean(task.done),
          createdAt: typeof task.createdAt === "number" ? task.createdAt : 0,
          order: typeof task.order === "number" ? task.order : null,
        }))
        .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
    }
    return next;
  }

  async function addScheduled(dateKey, text, note = "") {
    const trimmed = text.trim();
    if (!trimmed || !dateKey) return;
    const now = Date.now();
    const newRef = push(dayRef(dateKey));
    await set(newRef, {
      text: trimmed,
      note: note.trim(),
      done: false,
      createdAt: now,
      order: now,
    });
  }

  async function updateScheduled(dateKey, taskId, changes) {
    await update(scheduledRef(dateKey, taskId), changes);
  }

  async function deleteScheduled(dateKey, taskId) {
    await remove(scheduledRef(dateKey, taskId));
  }

  function createScheduleItem(dateKey, task) {
    const template = document.getElementById("schedule-item-template");
    if (!template) return document.createElement("li");
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = task.id;
    node.draggable = true;

    const check = node.querySelector(".task-check");
    const textEl = node.querySelector(".task-text");
    const noteEl = node.querySelector(".schedule-item-note");
    const editWrap = node.querySelector(".schedule-item-edit");
    const editText = node.querySelector(".schedule-edit-text");
    const editNote = node.querySelector(".schedule-edit-note");
    const editBtn = node.querySelector(".edit-btn");
    const deleteBtn = node.querySelector(".delete-btn");

    check.checked = task.done;
    textEl.textContent = task.text;
    noteEl.textContent = task.note || "";
    editText.value = task.text;
    editNote.value = task.note || "";
    node.classList.toggle("is-done", task.done);

    check.addEventListener("change", async () => {
      try {
        await updateScheduled(dateKey, task.id, { done: check.checked });
      } catch (err) {
        check.checked = !check.checked;
        reportFirebaseError(err);
      }
    });

    function startEdit() {
      node.classList.add("is-editing");
      editWrap.hidden = false;
      editText.value = task.text;
      editNote.value = task.note || "";
      editBtn.textContent = "save";
      editText.focus();
      editText.select();
    }

    async function finishEdit() {
      if (!node.classList.contains("is-editing")) return;
      node.classList.remove("is-editing");
      editWrap.hidden = true;
      editBtn.textContent = "edit";

      const text = editText.value.trim();
      const note = editNote.value.trim();

      try {
        if (!text) {
          await deleteScheduled(dateKey, task.id);
          return;
        }
        if (text !== task.text || note !== (task.note || "")) {
          await updateScheduled(dateKey, task.id, { text, note });
        }
      } catch (err) {
        reportFirebaseError(err);
      }
    }

    function cancelEdit() {
      node.classList.remove("is-editing");
      editWrap.hidden = true;
      editBtn.textContent = "edit";
      editText.value = task.text;
      editNote.value = task.note || "";
    }

    editBtn.addEventListener("click", () => {
      if (node.classList.contains("is-editing")) finishEdit();
      else startEdit();
    });

    textEl.addEventListener("dblclick", startEdit);

    editText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishEdit();
      }
      if (e.key === "Escape") cancelEdit();
    });

    deleteBtn.addEventListener("click", async () => {
      try {
        await deleteScheduled(dateKey, task.id);
      } catch (err) {
        reportFirebaseError(err);
      }
    });

    return node;
  }

  function fillList(listEl, dateKey) {
    if (!listEl) return;
    listEl.replaceChildren();
    // Re-bind sortable after rebuild: clear flag so bindSortableList can attach once per list element lifetime
    // Lists in week view are recreated each render, so binding each time is fine.
    delete listEl.dataset.sortableBound;
    for (const task of tasksFor(dateKey)) {
      listEl.appendChild(createScheduleItem(dateKey, task));
    }
    bindSortableList(listEl, {
      getId: (el) => el.dataset.id,
      reportError: reportFirebaseError,
      onReorder: async (orderedIds) => {
        const current = tasksFor(dateKey);
        const byId = Object.fromEntries(current.map((t) => [t.id, t]));
        scheduled[dateKey] = orderedIds.map((id, index) => ({
          ...byId[id],
          order: index,
        }));
        fillList(listEl, dateKey);
        const updates = {};
        orderedIds.forEach((id, index) => {
          updates[`${SCHEDULED_PATH}/${dateKey}/${id}/order`] = index;
        });
        await update(ref(db), updates);
      },
    });
  }

  function renderMonth() {
    const label = document.getElementById("month-label");
    const grid = document.getElementById("month-grid");
    if (!label || !grid) return;

    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    label.textContent = `${MONTHS[month]} ${year}`;
    grid.replaceChildren();

    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = toDateKey(startOfDay(new Date()));

    for (let i = 0; i < startPad; i++) {
      const empty = document.createElement("div");
      empty.className = "cal-cell is-empty";
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = toDateKey(date);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-cell";
      btn.textContent = String(day);

      if (key === todayKey) btn.classList.add("is-today");
      if (key === selectedDate) btn.classList.add("is-selected");
      if (tasksFor(key).length) {
        const dot = document.createElement("span");
        dot.className = "cal-dot";
        btn.appendChild(dot);
      }

      btn.addEventListener("click", () => {
        selectedDate = key;
        cursor = fromDateKey(key);
        renderActiveView();
      });

      grid.appendChild(btn);
    }

    const dayLabel = document.getElementById("month-day-label");
    if (dayLabel) dayLabel.textContent = formatLongDate(selectedDate);
    fillList(document.getElementById("month-day-list"), selectedDate);
  }

  function startOfWeek(d) {
    const x = startOfDay(d);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }

  function renderWeek() {
    const label = document.getElementById("week-label");
    const grid = document.getElementById("week-grid");
    if (!label || !grid) return;

    const weekStart = startOfWeek(cursor);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    label.textContent =
      `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;

    grid.replaceChildren();
    const todayKey = toDateKey(startOfDay(new Date()));

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      const key = toDateKey(date);

      const col = document.createElement("div");
      col.className = "week-col";
      if (key === selectedDate) col.classList.add("is-selected");
      if (key === todayKey) col.classList.add("is-today");

      const head = document.createElement("div");
      head.className = "week-col-head";
      head.innerHTML = `<span class="week-col-weekday">${WEEKDAYS[i]}</span><span class="week-col-date">${date.getDate()}</span>`;
      head.addEventListener("click", () => {
        if (lockedView === "week") {
          window.location.href = `day.html?date=${key}`;
          return;
        }
        selectedDate = key;
        cursor = fromDateKey(key);
        setView("day");
      });

      const list = document.createElement("ul");
      list.className = "schedule-list";
      fillList(list, key);

      const form = document.createElement("form");
      form.className = "schedule-add-form";
      form.autocomplete = "off";
      form.innerHTML = `
        <input type="text" class="schedule-input" placeholder="add…" required />
        <button type="submit" class="save-btn">save</button>
      `;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = form.querySelector(".schedule-input");
        try {
          await addScheduled(key, input.value);
          input.value = "";
          input.focus();
        } catch (err) {
          reportFirebaseError(err);
        }
      });

      col.append(head, list, form);
      grid.appendChild(col);
    }
  }

  function renderDay() {
    const label = document.getElementById("day-label");
    if (!label) return;
    selectedDate = toDateKey(cursor);
    label.textContent = formatLongDate(selectedDate);
    fillList(document.getElementById("day-list"), selectedDate);
  }

  function renderActiveView() {
    if (currentView === "month") renderMonth();
    else if (currentView === "week") renderWeek();
    else renderDay();
  }

  function setView(view) {
    if (lockedView) view = lockedView;
    currentView = view;

    document.querySelectorAll(".schedule-tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".schedule-panel").forEach((panel) => {
      const active = panel.dataset.panel === view;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    renderActiveView();
  }

  document.querySelectorAll(".schedule-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (lockedView) return;
      setView(tab.dataset.view);
    });
  });

  document.getElementById("month-prev")?.addEventListener("click", () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    selectedDate = toDateKey(cursor);
    renderActiveView();
  });

  document.getElementById("month-next")?.addEventListener("click", () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    selectedDate = toDateKey(cursor);
    renderActiveView();
  });

  document.getElementById("week-prev")?.addEventListener("click", () => {
    cursor.setDate(cursor.getDate() - 7);
    cursor = startOfDay(cursor);
    selectedDate = toDateKey(cursor);
    renderActiveView();
  });

  document.getElementById("week-next")?.addEventListener("click", () => {
    cursor.setDate(cursor.getDate() + 7);
    cursor = startOfDay(cursor);
    selectedDate = toDateKey(cursor);
    renderActiveView();
  });

  document.getElementById("day-prev")?.addEventListener("click", () => {
    cursor.setDate(cursor.getDate() - 1);
    cursor = startOfDay(cursor);
    selectedDate = toDateKey(cursor);
    renderActiveView();
  });

  document.getElementById("day-next")?.addEventListener("click", () => {
    cursor.setDate(cursor.getDate() + 1);
    cursor = startOfDay(cursor);
    selectedDate = toDateKey(cursor);
    renderActiveView();
  });

  document.querySelectorAll('.schedule-add-form[data-target="selected"]').forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = form.querySelector(".schedule-input");
      const noteEl = form.querySelector(".schedule-note, .schedule-note-area");
      try {
        await addScheduled(selectedDate, input.value, noteEl?.value || "");
        input.value = "";
        if (noteEl) noteEl.value = "";
        input.focus();
      } catch (err) {
        reportFirebaseError(err);
      }
    });
  });

  onValue(
    ref(db, SCHEDULED_PATH),
    (snapshot) => {
      scheduled = parseScheduled(snapshot);
      renderActiveView();
    },
    (error) => reportFirebaseError(error)
  );

  setView(currentView);
}
