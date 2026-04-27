import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBT6apLSSwS5oHZmToU97cJXFprwDi6CG4",
  authDomain: "atlas-caixa-firebase.firebaseapp.com",
  projectId: "atlas-caixa-firebase",
  storageBucket: "atlas-caixa-firebase.firebasestorage.app",
  messagingSenderId: "1096863796790",
  appId: "1:1096863796790:web:bc2d556122233c8bd7d297"
};

export const ADMIN_EMAIL = "ordepluissantosfrancisco@gmail.com";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
