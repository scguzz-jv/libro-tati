import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  collection,
  doc,
  enableIndexedDbPersistence,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCowNwrf4rdCxiAh4wMsMns-hspuOAcjLM",
  authDomain: "libro-d35e4.firebaseapp.com",
  projectId: "libro-d35e4",
  storageBucket: "libro-d35e4.firebasestorage.app",
  messagingSenderId: "263640396688",
  appId: "1:263640396688:web:00b56e4fa799698e36b915",
  measurementId: "G-0XL40TNNY5",
};

const cloudinaryConfig = {
  cloudName: "dw9nwy3y1",
  uploadPreset: "preset_anonimo",
  folder: "libro-vivo-studio",
};

let appInstance = null;
let authInstance = null;
let dbInstance = null;
let initCache = null;

function hasPlaceholder(value) {
  return !value || String(value).includes("YOUR_");
}

export function isFirebaseConfigured() {
  const requiredValues = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.messagingSenderId,
    firebaseConfig.appId,
  ];

  return requiredValues.every((value) => !hasPlaceholder(value));
}

export function isCloudinaryConfigured() {
  return [cloudinaryConfig.cloudName, cloudinaryConfig.uploadPreset].every(
    (value) => !hasPlaceholder(value),
  );
}

export function getCloudinarySetupState() {
  return {
    configured: isCloudinaryConfigured(),
    cloudName: cloudinaryConfig.cloudName,
    uploadPreset: cloudinaryConfig.uploadPreset,
    folder: cloudinaryConfig.folder,
  };
}

export async function initializeFirebaseServices() {
  if (initCache) {
    return initCache;
  }

  if (!isFirebaseConfigured()) {
    initCache = {
      enabled: false,
      persistenceEnabled: false,
      reason: "missing-config",
    };
    return initCache;
  }

  appInstance = initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);
  dbInstance = getFirestore(appInstance);

  await setPersistence(authInstance, browserLocalPersistence);

  let persistenceEnabled = false;

  try {
    await enableIndexedDbPersistence(dbInstance);
    persistenceEnabled = true;
  } catch (error) {
    console.warn("No se pudo activar la persistencia local de Firestore.", error);
  }

  initCache = {
    enabled: true,
    persistenceEnabled,
    reason: null,
  };

  return initCache;
}

export async function ensureAnonymousUser() {
  const init = await initializeFirebaseServices();

  if (!init.enabled || !authInstance) {
    return null;
  }

  if (authInstance.currentUser) {
    return authInstance.currentUser;
  }

  const credential = await signInAnonymously(authInstance);
  return credential.user;
}

export async function fetchRemoteBook(uid) {
  const init = await initializeFirebaseServices();

  if (!init.enabled || !dbInstance || !uid) {
    return null;
  }

  const bookRef = doc(dbInstance, "books", uid);
  const spreadsRef = collection(bookRef, "spreads");

  const [bookSnapshot, spreadSnapshot] = await Promise.all([
    getDoc(bookRef),
    getDocs(spreadsRef),
  ]);

  if (!bookSnapshot.exists() && spreadSnapshot.empty) {
    return null;
  }

  const book = bookSnapshot.exists() ? bookSnapshot.data() : {};
  const spreads = spreadSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  }));

  const order = Array.isArray(book.spreadOrder) ? book.spreadOrder : [];

  spreads.sort((left, right) => {
    const leftIndex = order.indexOf(left.id);
    const rightIndex = order.indexOf(right.id);

    if (leftIndex === -1 && rightIndex === -1) {
      return (left.createdAtClient || 0) - (right.createdAtClient || 0);
    }

    if (leftIndex === -1) {
      return 1;
    }

    if (rightIndex === -1) {
      return -1;
    }

    return leftIndex - rightIndex;
  });

  return {
    book,
    spreads,
    pendingUploads: [],
  };
}

export async function saveRemoteBook(uid, payload) {
  const init = await initializeFirebaseServices();

  if (!init.enabled || !dbInstance || !uid) {
    return false;
  }

  const bookRef = doc(dbInstance, "books", uid);
  const batch = writeBatch(dbInstance);
  const now = payload.book.updatedAtClient || Date.now();

  batch.set(
    bookRef,
    {
      title: payload.book.title,
      subtitle: payload.book.subtitle,
      author: payload.book.author,
      coverImage: payload.book.coverImage || {
        src: "",
        publicId: null,
        assetId: null,
        updatedAtClient: now,
      },
      theme: payload.book.theme,
      lastPageIndex: payload.book.lastPageIndex,
      spreadOrder: payload.book.spreadOrder,
      createdAtClient: payload.book.createdAtClient || now,
      updatedAtClient: now,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  for (const spread of payload.spreads) {
    const spreadRef = doc(collection(bookRef, "spreads"), spread.id);
    batch.set(
      spreadRef,
      {
        title: spread.title,
        textHtml: spread.textHtml,
        textPlain: spread.textPlain,
        textWordCount: spread.textWordCount,
        pageStyles: spread.pageStyles || null,
        imageItems: Array.isArray(spread.imageItems) ? spread.imageItems : [],
        createdAtClient: spread.createdAtClient || now,
        updatedAtClient: spread.updatedAtClient || now,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  for (const spreadId of payload.deletedSpreadIds || []) {
    const spreadRef = doc(collection(bookRef, "spreads"), spreadId);
    batch.delete(spreadRef);
  }

  await batch.commit();
  return true;
}

export async function uploadImageToCloudinary({ file, uid, spreadId, imageId }) {
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary no esta configurado.");
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`;
  const formData = new FormData();
  const folderParts = [cloudinaryConfig.folder, uid, spreadId].filter(Boolean);

  formData.append("file", file);
  formData.append("upload_preset", cloudinaryConfig.uploadPreset);

  if (folderParts.length) {
    formData.append("folder", folderParts.join("/"));
  }

  if (imageId) {
    formData.append("public_id", imageId);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || !data.secure_url) {
    throw new Error(data?.error?.message || "Cloudinary rechazo la subida.");
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id || null,
    assetId: data.asset_id || null,
  };
}
