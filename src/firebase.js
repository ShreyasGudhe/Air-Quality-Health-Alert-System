import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDcV4MPAGtzgDJxmf7qMN2MCTCh2NIuxpc",
  authDomain: "air-quality-and-health-alert.firebaseapp.com",
  projectId: "air-quality-and-health-alert",
  storageBucket: "air-quality-and-health-alert.appspot.com",
  messagingSenderId: "783350047960",
  appId: "1:783350047960:web:d39ef4daa4d6b8c06f23ad",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
