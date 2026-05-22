# Libro Nube Studio

Aplicacion web en HTML, CSS y JavaScript Vanilla para crear libros digitales online con:

- editor moderno usando Quill
- autenticacion anonima con Firebase
- autosave en Firestore
- subida automatica de imagenes a Cloudinary
- respaldo temporal en `localStorage`
- capitulos multiples
- portada editable
- modo oscuro
- exportacion a PDF

## Estructura de carpetas

```text
archivo general/
|- index.html
|- style.css
|- app.js
|- firebase.js
`- README.md
```

## Estado actual

- Firebase ya quedo configurado en [firebase.js](<C:/Users/USUARIO/Desktop/archivo general/firebase.js>)
- Cloudinary ya quedo configurado en [firebase.js](<C:/Users/USUARIO/Desktop/archivo general/firebase.js>)
- La app ya funciona con texto en Firestore y respaldo local
- Solo falta activar `Anonymous` en Firebase Authentication para que la sincronizacion en la nube quede operativa

## Configuracion exacta que falta

Abre [firebase.js](<C:/Users/USUARIO/Desktop/archivo general/firebase.js>) y busca este bloque:

```js
const cloudinaryConfig = {
  cloudName: "YOUR_CLOUDINARY_CLOUD_NAME",
  uploadPreset: "YOUR_UNSIGNED_UPLOAD_PRESET",
  folder: "libro-nube-studio",
};
```

Reemplaza:

- `YOUR_CLOUDINARY_CLOUD_NAME`
- `YOUR_UNSIGNED_UPLOAD_PRESET`

No pongas `api_secret` ni `api_key` en esta app frontend.

## Como crear Cloudinary gratis

### 1. Crear cuenta

1. Entra a [Cloudinary](https://cloudinary.com/).
2. Crea una cuenta gratuita.
3. En el dashboard copia tu `Cloud name`.

### 2. Crear el upload preset unsigned

1. Entra a `Settings`.
2. Abre `Upload`.
3. Busca `Upload presets`.
4. Haz clic en `Add upload preset`.
5. Configuralo asi:

- Signing Mode: `Unsigned`
- Folder: `libro-nube-studio`
- Allowed formats: `jpg,png,jpeg,webp,gif`
- Max file size: por ejemplo `10 MB`
- Disallow public ID: activado si aparece disponible

6. Guarda el preset.
7. Copia el nombre del preset y pegalo en `uploadPreset`.

## Firebase paso a paso

### 1. Activar autenticacion anonima

1. Ve a [Firebase Console](https://console.firebase.google.com/).
2. Abre tu proyecto `libro-d35e4`.
3. Ve a `Authentication`.
4. Abre `Sign-in method`.
5. Activa `Anonymous`.

### 2. Crear Firestore Database

1. Ve a `Firestore Database`.
2. Crea la base de datos.
3. Usa estas reglas:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /books/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /chapters/{chapterId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

### 3. Autorizar dominios

Agrega estos dominios en `Authentication` -> `Settings` -> `Authorized domains`:

- `localhost`
- tu dominio final si usas GitHub Pages, por ejemplo `tuusuario.github.io`

## Como probar localmente

En la carpeta `archivo general`, ejecuta:

```powershell
py -m http.server 5500
```

Luego abre:

```txt
http://localhost:5500
```

## Despliegue en GitHub Pages

1. Sube los archivos a un repositorio.
2. Verifica que `firebase.js` tenga:
   - tu config de Firebase
   - tu `cloudName`
   - tu `uploadPreset`
3. Activa GitHub Pages.
4. Autoriza el dominio en Firebase Authentication.

## Despliegue en Firebase Hosting

En la misma carpeta:

```powershell
firebase init hosting
firebase deploy
```

Sugerencias durante `firebase init hosting`:

- selecciona el proyecto `libro-d35e4`
- usa la carpeta actual como carpeta publica
- responde `No` si pregunta por SPA rewrite

## Que guarda la aplicacion

- titulo del libro
- subtitulo
- autor
- capitulos
- contenido enriquecido del editor
- URLs finales de imagenes subidas a Cloudinary
- modo visual
- ultimo capitulo activo

## Como funciona el guardado

- guarda al escribir con `debounce`
- hace autosave periodico cada pocos segundos
- sube primero las imagenes a Cloudinary
- luego guarda el HTML del capitulo en Firestore
- si no hay internet, conserva una copia en `localStorage`
- cuando vuelve la conexion, reintenta sincronizar

## Nota importante

La sesion anonima de Firebase normalmente persiste en el mismo navegador. Si el usuario borra manualmente los datos del navegador, Firebase puede asignar una nueva identidad y se perdera el acceso al libro anterior de esa sesion.
