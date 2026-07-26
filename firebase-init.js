/* =====================================================================
   FIREBASE — вставь сюда свои данные из консоли Firebase
   console.firebase.google.com → Настройки проекта → Ваши приложения → Web
   ===================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyCdwiGKTwkgF4KmCYGQmHiGFsqmzpkfjuE",
  authDomain: "mountain-ff48d.firebaseapp.com",
  projectId: "mountain-ff48d",
  storageBucket: "mountain-ff48d.firebasestorage.app",
  messagingSenderId: "525938677494",
  appId: "1:525938677494:web:db00bbd8382d01b93ffed7",
};

window.MOUNTAIN_FIREBASE_CONFIGURED = firebaseConfig.apiKey !== "ВСТАВЬ_СЮДА";

if (window.MOUNTAIN_FIREBASE_CONFIGURED) {
  firebase.initializeApp(firebaseConfig);
} else {
  console.warn('Mountain: Firebase не настроен — работаю в оффлайн-режиме (localStorage). Заполни firebase-init.js, чтобы включить синк между устройствами.');
}
