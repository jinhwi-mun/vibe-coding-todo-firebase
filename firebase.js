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

export {
  db,
  ref,
  push,
  set,
  get,
  onValue,
  update,
  remove,
};

export function reportFirebaseError(err) {
  console.error(err);
  alert("Could not sync with Firebase. Check your Realtime Database rules and connection.");
}
