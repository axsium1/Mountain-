/* =====================================================================
   FIREBASE — вставь сюда свои данные из консоли Firebase
   console.firebase.google.com → Настройки проекта → Ваши приложения → Web
   ===================================================================== */
const firebaseConfig = {
  apiKey: "ВСТАВЬ_СЮДА",
  authDomain: "ВСТАВЬ_СЮДА",
  projectId: "ВСТАВЬ_СЮДА",
  storageBucket: "ВСТАВЬ_СЮДА",
  messagingSenderId: "ВСТАВЬ_СЮДА",
  appId: "ВСТАВЬ_СЮДА",
};

window.MOUNTAIN_FIREBASE_CONFIGURED = firebaseConfig.apiKey !== "ВСТАВЬ_СЮДА";

if (window.MOUNTAIN_FIREBASE_CONFIGURED) {
  firebase.initializeApp(firebaseConfig);
} else {
  console.warn('Mountain: Firebase не настроен — работаю в оффлайн-режиме (localStorage). Заполни firebase-init.js, чтобы включить синк между устройствами.');
}
