import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyB43QRum9SVQ8I0SzfJ4zJI_actXfaaDGA",
    authDomain: "codesapiensbot.firebaseapp.com",
    projectId: "codesapiensbot",
    storageBucket: "codesapiensbot.appspot.com",
    messagingSenderId: "137803754408",
    appId: "1:137803754408:web:56bb3a09cfcbfe94d34b9d",
    measurementId: "G-88NKDM9XFE"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
