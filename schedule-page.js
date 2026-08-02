import {
  db,
  ref,
  push,
  set,
  onValue,
  update,
  remove,
  reportFirebaseError,
} from "./firebase.js";
import { initSchedule } from "./schedule.js";

const path = window.location.pathname;
let lockedView = "month";
if (path.includes("week")) lockedView = "week";
else if (path.includes("day")) lockedView = "day";

const params = new URLSearchParams(window.location.search);
const initialDate = params.get("date") || undefined;

initSchedule(
  { db, ref, push, set, onValue, update, remove, reportFirebaseError },
  { lockedView, initialDate }
);
