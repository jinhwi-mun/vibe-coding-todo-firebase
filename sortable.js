/**
 * Same-list HTML5 drag reorder.
 * @param {HTMLElement} listEl
 * @param {{
 *   itemSelector?: string,
 *   getId: (el: HTMLElement) => string,
 *   onReorder: (orderedIds: string[]) => void | Promise<void>,
 *   reportError?: (err: any) => void,
 * }} options
 */
export function bindSortableList(listEl, options) {
  if (!listEl || listEl.dataset.sortableBound === "1") return;
  listEl.dataset.sortableBound = "1";

  const itemSelector = options.itemSelector || ":scope > li";
  let dragId = null;

  function clearIndicators() {
    listEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  }

  function items() {
    return [...listEl.querySelectorAll(itemSelector)];
  }

  listEl.addEventListener("dragstart", (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || !listEl.contains(item)) return;
    if (item.classList.contains("is-editing")) {
      e.preventDefault();
      return;
    }
    if (e.target.closest("input, button, label, textarea, a")) {
      e.preventDefault();
      return;
    }

    dragId = options.getId(item);
    item.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
  });

  listEl.addEventListener("dragend", (e) => {
    const item = e.target.closest(itemSelector);
    item?.classList.remove("is-dragging");
    clearIndicators();
    dragId = null;
  });

  listEl.addEventListener("dragover", (e) => {
    if (!dragId) return;
    const item = e.target.closest(itemSelector);
    if (!item || !listEl.contains(item)) {
      e.preventDefault();
      return;
    }
    if (options.getId(item) === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clearIndicators();
    item.classList.add("drag-over");
  });

  listEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    clearIndicators();
    if (!dragId) return;

    const target = e.target.closest(itemSelector);
    const ordered = items().map((el) => options.getId(el));
    const from = ordered.indexOf(dragId);
    if (from < 0) return;

    let to = ordered.length - 1;
    if (target && listEl.contains(target)) {
      const targetId = options.getId(target);
      to = ordered.indexOf(targetId);
      if (to < 0) return;
      if (dragId === targetId) return;
    }

    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    try {
      await options.onReorder(next);
    } catch (err) {
      options.reportError?.(err);
    }
  });
}
