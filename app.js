import {
  ensureAnonymousUser,
  fetchRemoteBook,
  getCloudinarySetupState,
  initializeFirebaseServices,
  isCloudinaryConfigured,
  isFirebaseConfigured,
  saveRemoteBook,
  uploadImageToCloudinary,
} from "./firebase.js";

const LOCAL_BACKUP_KEY = "libro-vivo-studio-backup";
const THEME_KEY = "libro-vivo-studio-theme";
const SAVE_DEBOUNCE_MS = 1200;
const SAVE_INTERVAL_MS = 7000;
const TOAST_DURATION_MS = 3200;
const IMAGE_MIN_SIZE = 16;
const DEFAULT_TEXT_PAGE_COLOR = "#DFF2FF";
const DEFAULT_IMAGE_PAGE_COLOR = "#FCF56D";

const FONT_WHITELIST = [
  "manrope",
  "cormorant",
  "nunito",
  "plexserif",
  "spacegrotesk",
];

class LibroVivoStudio {
  constructor() {
    this.quill = null;
    this.user = null;
    this.firebaseEnabled = false;
    this.firebasePersistenceEnabled = false;
    this.cloudinaryEnabled = false;
    this.isHydrating = false;
    this.isSaving = false;
    this.isAnimating = false;
    this.paletteOpen = false;
    this.presentationMode = false;
    this.sidebarOpen = false;
    this.currentPageIndex = 0;
    this.selectedImageId = null;
    this.toastTimer = null;
    this.saveTimer = null;
    this.intervalHandle = null;
    this.interaction = null;
    this.deletedSpreadIds = new Set();
    this.pendingUploads = [];
    this.dirtySpreads = new Set();
    this.dirtyMeta = false;
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);

    this.state = this.createDefaultState();

    this.elements = {
      addImageFrameButton: document.getElementById("addImageFrameButton"),
      addSpreadButton: document.getElementById("addSpreadButton"),
      authStateText: document.getElementById("authStateText"),
      backupStateText: document.getElementById("backupStateText"),
      bookAuthorInput: document.getElementById("bookAuthorInput"),
      bookPage: document.getElementById("bookPage"),
      bookSubtitleInput: document.getElementById("bookSubtitleInput"),
      bookTitleInput: document.getElementById("bookTitleInput"),
      bringForwardButton: document.getElementById("bringForwardButton"),
      cloudStateText: document.getElementById("cloudStateText"),
      connectivityText: document.getElementById("connectivityText"),
      controlStrip: document.getElementById("controlStrip"),
      coverAuthorLine: document.getElementById("coverAuthorLine"),
      coverAuthorPreview: document.getElementById("coverAuthorPreview"),
      coverCard: document.getElementById("coverCard"),
      coverImageButton: document.getElementById("coverImageButton"),
      coverImageEmpty: document.getElementById("coverImageEmpty"),
      coverImageInput: document.getElementById("coverImageInput"),
      coverImagePreview: document.getElementById("coverImagePreview"),
      coverMedia: document.getElementById("coverMedia"),
      removeCoverImageButton: document.getElementById("removeCoverImageButton"),
      coverSubjectLine: document.getElementById("coverSubjectLine"),
      coverSubtitlePreview: document.getElementById("coverSubtitlePreview"),
      coverTitlePreview: document.getElementById("coverTitlePreview"),
      coverView: document.getElementById("coverView"),
      deleteSpreadButton: document.getElementById("deleteSpreadButton"),
      downloadPdfButton: document.getElementById("downloadPdfButton"),
      exitPresentationButton: document.getElementById("exitPresentationButton"),
      fullscreenToggleButton: document.getElementById("fullscreenToggleButton"),
      imageCanvas: document.getElementById("imageCanvas"),
      imageCanvasHint: document.getElementById("imageCanvasHint"),
      imageTools: document.getElementById("imageTools"),
      imageView: document.getElementById("imageView"),
      lastSavedText: document.getElementById("lastSavedText"),
      menuToggle: document.getElementById("menuToggle"),
      nextPageButton: document.getElementById("nextPageButton"),
      paletteColorInput: document.getElementById("paletteColorInput"),
      paletteDot: document.getElementById("paletteDot"),
      paletteHexText: document.getElementById("paletteHexText"),
      palettePanel: document.getElementById("palettePanel"),
      palettePreview: document.getElementById("palettePreview"),
      palettePreviewLabel: document.getElementById("palettePreviewLabel"),
      paletteStrip: document.getElementById("paletteStrip"),
      paletteToggleButton: document.getElementById("paletteToggleButton"),
      pageCounter: document.getElementById("pageCounter"),
      pageKindLabel: document.getElementById("pageKindLabel"),
      pageLabel: document.getElementById("pageLabel"),
      presentationHud: document.getElementById("presentationHud"),
      presentationModeButton: document.getElementById("presentationModeButton"),
      presentationPageCounter: document.getElementById("presentationPageCounter"),
      presentationPageLabel: document.getElementById("presentationPageLabel"),
      prevPageButton: document.getElementById("prevPageButton"),
      recoveryText: document.getElementById("recoveryText"),
      removeImageFrameButton: document.getElementById("removeImageFrameButton"),
      resetPageColorButton: document.getElementById("resetPageColorButton"),
      restoreBackupButton: document.getElementById("restoreBackupButton"),
      saveNowButton: document.getElementById("saveNowButton"),
      saveStatusChip: document.getElementById("saveStatusChip"),
      saveStatusText: document.getElementById("saveStatusText"),
      sidebar: document.getElementById("sidebar"),
      sidebarBackdrop: document.getElementById("sidebarBackdrop"),
      spreadList: document.getElementById("spreadList"),
      spreadTitleInput: document.getElementById("spreadTitleInput"),
      textTools: document.getElementById("textTools"),
      textEditor: document.getElementById("textEditor"),
      textView: document.getElementById("textView"),
      themeToggle: document.getElementById("themeToggle"),
      themeToggleLabel: document.getElementById("themeToggleLabel"),
      toast: document.getElementById("toast"),
      totalWordCount: document.getElementById("totalWordCount"),
      wordCount: document.getElementById("wordCount"),
    };
  }

  createDefaultState() {
    const spreadId = this.makeId();
    const now = Date.now();

    return {
      book: {
        title: "",
        subtitle: "",
        author: "",
        coverImage: {
          src: "",
          publicId: null,
          assetId: null,
          updatedAtClient: now,
        },
        theme: this.readTheme(),
        lastPageIndex: 0,
        createdAtClient: now,
        updatedAtClient: now,
      },
      spreads: [
        {
          id: spreadId,
          title: "",
          textHtml: "<p><br></p>",
          textPlain: "",
          textWordCount: 0,
          pageStyles: {
            textColor: DEFAULT_TEXT_PAGE_COLOR,
            imageColor: DEFAULT_IMAGE_PAGE_COLOR,
          },
          imageItems: [],
          createdAtClient: now,
          updatedAtClient: now,
        },
      ],
    };
  }

  async init() {
    this.configureQuillFonts();
    this.applyTheme(this.readTheme());
    this.initQuill();
    this.bindEvents();

    const localBackup = this.getLocalBackup();
    if (localBackup) {
      this.hydrateState(localBackup, { markDirty: false });
      this.elements.recoveryText.textContent = "Se cargo una copia local mientras se inicializa la nube.";
    } else {
      this.renderAll();
    }

    this.updateConnectivityUI();
    this.setSaveStatus("idle", "Listo para editar");
    this.startAutosaveLoop();
    this.updatePresentationUI();
    await this.initializeCloud();
  }

  configureQuillFonts() {
    const Font = window.Quill.import("formats/font");
    Font.whitelist = FONT_WHITELIST;
    window.Quill.register(Font, true);
  }

  initQuill() {
    this.quill = new window.Quill("#textEditor", {
      theme: "snow",
      placeholder: "",
      modules: {
        toolbar: "#textToolbar",
        history: {
          delay: 500,
          maxStack: 250,
          userOnly: true,
        },
      },
    });

    this.quill.on("text-change", (_delta, _oldDelta, source) => {
      const descriptor = this.getCurrentPageDescriptor();
      if (source !== "user" || this.isHydrating || descriptor.type !== "text") {
        return;
      }

      const spread = descriptor.spread;
      spread.textHtml = this.quill.root.innerHTML;
      spread.textPlain = this.quill.getText().trim();
      spread.textWordCount = this.countWords(spread.textPlain);
      spread.updatedAtClient = Date.now();
      this.touchBook();
      this.markSpreadDirty(spread.id);
      this.persistLocalBackup();
      this.renderCounters();
      this.setSaveStatus("saving", "Guardando...");
      this.queueSave();
    });
  }

  bindEvents() {
    this.elements.bookTitleInput.addEventListener("input", (event) => {
      this.state.book.title = event.target.value.trim();
      this.handleMetaChange();
    });

    this.elements.bookSubtitleInput.addEventListener("input", (event) => {
      this.state.book.subtitle = event.target.value.trim();
      this.handleMetaChange();
    });

    this.elements.bookAuthorInput.addEventListener("input", (event) => {
      this.state.book.author = event.target.value.trim();
      this.handleMetaChange();
    });

    this.elements.coverImageButton.addEventListener("click", () => {
      this.elements.coverImageInput.click();
    });

    this.elements.coverImageInput.addEventListener("change", async (event) => {
      const [file] = Array.from(event.target.files || []);
      if (file) {
        await this.attachCoverImage(file);
      }

      event.target.value = "";
    });

    this.elements.removeCoverImageButton.addEventListener("click", () => {
      this.removeCoverImage();
    });

    this.elements.spreadTitleInput.addEventListener("input", (event) => {
      const spread = this.getCurrentSpread();
      if (!spread) {
        return;
      }

      spread.title = event.target.value.trim();
      spread.updatedAtClient = Date.now();
      this.touchBook();
      this.markSpreadDirty(spread.id);
      this.renderSpreadList();
      this.renderLabels();
      this.applyDisplayLabels();
      this.persistLocalBackup();
      this.queueSave();
    });

    this.elements.addSpreadButton.addEventListener("click", () => {
      this.addSpread();
    });

    this.elements.deleteSpreadButton.addEventListener("click", () => {
      this.deleteCurrentSpread();
    });

    this.elements.saveNowButton.addEventListener("click", async () => {
      await this.saveNow({ force: true });
    });

    this.elements.restoreBackupButton.addEventListener("click", () => {
      const backup = this.getLocalBackup();
      if (!backup) {
        this.showToast("No existe un respaldo local para restaurar.");
        return;
      }

      this.hydrateState(backup, { markDirty: true });
      this.persistLocalBackup();
      this.showToast("Respaldo local restaurado.");
    });

    this.elements.themeToggle.addEventListener("click", () => {
      const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      this.applyTheme(nextTheme);
      this.state.book.theme = nextTheme;
      this.handleMetaChange();
    });

    this.elements.prevPageButton.addEventListener("click", () => {
      void this.navigateToPage(this.currentPageIndex - 1);
    });

    this.elements.nextPageButton.addEventListener("click", () => {
      void this.navigateToPage(this.currentPageIndex + 1);
    });

    this.elements.downloadPdfButton.addEventListener("click", () => {
      this.downloadAsPdf();
    });

    this.elements.paletteToggleButton.addEventListener("click", () => {
      this.togglePalettePanel();
    });

    this.elements.paletteColorInput.addEventListener("input", (event) => {
      this.applyCurrentPageColor(event.target.value);
    });

    this.elements.paletteColorInput.addEventListener("change", (event) => {
      this.applyCurrentPageColor(event.target.value);
    });

    this.elements.resetPageColorButton.addEventListener("click", () => {
      this.resetCurrentPageColor();
    });

    this.elements.palettePanel.addEventListener("click", (event) => {
      const swatch = event.target.closest(".palette-swatch");
      if (!swatch) {
        return;
      }

      const fallback = this.getCurrentPageDescriptor().type === "image"
        ? DEFAULT_IMAGE_PAGE_COLOR
        : DEFAULT_TEXT_PAGE_COLOR;
      this.applyCurrentPageColor(swatch.dataset.color || fallback);
    });

    this.elements.coverCard.addEventListener("click", () => {
      if (this.getCurrentPageDescriptor().type === "cover" && !this.presentationMode) {
        this.elements.coverImageInput.click();
      }
    });

    this.elements.presentationModeButton.addEventListener("click", () => {
      void this.togglePresentationMode(true);
    });

    this.elements.exitPresentationButton.addEventListener("click", () => {
      void this.togglePresentationMode(false);
    });

    this.elements.fullscreenToggleButton.addEventListener("click", () => {
      void this.toggleFullscreen();
    });

    this.elements.menuToggle.addEventListener("click", () => {
      this.toggleSidebar(true);
    });

    this.elements.sidebarBackdrop.addEventListener("click", () => {
      this.toggleSidebar(false);
    });

    this.elements.addImageFrameButton.addEventListener("click", () => {
      this.addImageFrame();
    });

    this.elements.removeImageFrameButton.addEventListener("click", () => {
      this.removeSelectedImageFrame();
    });

    this.elements.bringForwardButton.addEventListener("click", () => {
      this.bringSelectedImageForward();
    });

    this.elements.imageCanvas.addEventListener("click", (event) => {
      const frame = event.target.closest(".image-frame");
      if (!frame) {
        this.selectImageFrame(null);
        return;
      }

      this.selectImageFrame(frame.dataset.imageId || null);
    });

    this.elements.imageCanvas.addEventListener("pointerdown", (event) => {
      this.handleCanvasPointerDown(event);
    });

    this.elements.coverCard.addEventListener("dragenter", (event) => {
      event.preventDefault();
      if (this.getCurrentPageDescriptor().type === "cover") {
        this.elements.coverCard.classList.add("is-drop");
      }
    });

    this.elements.coverCard.addEventListener("dragover", (event) => {
      if (this.getCurrentPageDescriptor().type !== "cover") {
        return;
      }

      event.preventDefault();
      this.elements.coverCard.classList.add("is-drop");
    });

    this.elements.coverCard.addEventListener("dragleave", (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        this.elements.coverCard.classList.remove("is-drop");
      }
    });

    this.elements.coverCard.addEventListener("drop", async (event) => {
      if (this.getCurrentPageDescriptor().type !== "cover") {
        return;
      }

      event.preventDefault();
      this.elements.coverCard.classList.remove("is-drop");

      const [file] = Array.from(event.dataTransfer?.files || []).filter((entry) =>
        entry.type.startsWith("image/"),
      );

      if (file) {
        await this.attachCoverImage(file);
      }
    });

    this.elements.imageCanvas.addEventListener("dragenter", (event) => {
      event.preventDefault();
      if (this.getCurrentPageDescriptor().type === "image") {
        this.elements.imageCanvas.classList.add("is-drop");
      }
    });

    this.elements.imageCanvas.addEventListener("dragover", (event) => {
      if (this.getCurrentPageDescriptor().type !== "image") {
        return;
      }

      event.preventDefault();
      this.elements.imageCanvas.classList.add("is-drop");
    });

    this.elements.imageCanvas.addEventListener("dragleave", (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        this.elements.imageCanvas.classList.remove("is-drop");
      }
    });

    this.elements.imageCanvas.addEventListener("drop", async (event) => {
      if (this.getCurrentPageDescriptor().type !== "image") {
        return;
      }

      event.preventDefault();
      this.elements.imageCanvas.classList.remove("is-drop");

      const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
        file.type.startsWith("image/"),
      );

      if (!files.length) {
        return;
      }

      await this.attachImagesToCurrentPage(files);
    });

    document.addEventListener("paste", async (event) => {
      const descriptor = this.getCurrentPageDescriptor();
      const files = this.extractImagesFromClipboard(event.clipboardData);
      if (!files.length) {
        return;
      }

      if (descriptor.type === "cover") {
        event.preventDefault();
        await this.attachCoverImage(files[0]);
        return;
      }

      if (descriptor.type === "image") {
        event.preventDefault();
        await this.attachImagesToCurrentPage(files);
      }
    });

    window.addEventListener("online", async () => {
      this.updateConnectivityUI();
      await this.processPendingUploads();
      await this.saveNow({ force: true });
    });

    window.addEventListener("offline", () => {
      this.updateConnectivityUI();
      this.setSaveStatus("offline", "Sin conexion. Respaldo local activo.");
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.captureCurrentTextPage();
        this.persistLocalBackup();
        void this.saveNow({ force: true });
      }
    });

    document.addEventListener("fullscreenchange", () => {
      this.updatePresentationUI();
    });

    document.addEventListener("keydown", (event) => {
      void this.handleKeyDown(event);
    });

    window.addEventListener("beforeunload", () => {
      this.captureCurrentTextPage();
      this.persistLocalBackup();
    });
  }

  async initializeCloud() {
    const initResult = await initializeFirebaseServices();
    this.firebaseEnabled = initResult.enabled;
    this.firebasePersistenceEnabled = initResult.persistenceEnabled;
    this.cloudinaryEnabled = isCloudinaryConfigured();

    if (!isFirebaseConfigured()) {
      this.elements.authStateText.textContent = "Modo local";
      this.elements.cloudStateText.textContent = "Configura firebase.js";
      this.elements.backupStateText.textContent = "Listo";
      this.elements.recoveryText.textContent = "Firebase aun no esta configurado. Puedes editar en local mientras tanto.";
      this.setSaveStatus("local", "Solo respaldo local");
      this.renderAll();
      return;
    }

    try {
      this.user = await ensureAnonymousUser();
      this.elements.authStateText.textContent = `Invitado ${this.user.uid.slice(0, 8)}`;
      this.elements.cloudStateText.textContent = this.getCloudStateLabel();

      const remoteState = await fetchRemoteBook(this.user.uid);
      const localBackup = this.getLocalBackup();
      const selectedState = this.selectNewestState(localBackup, remoteState);

      if (selectedState) {
        const shouldResync = selectedState.source === "local" && this.firebaseEnabled;
        this.hydrateState(selectedState.state, { markDirty: shouldResync });
        this.elements.recoveryText.textContent = selectedState.source === "local"
          ? "Se recupero una copia local y se volvera a sincronizar."
          : "Libro recuperado automaticamente desde Firestore.";
      } else {
        this.renderAll();
        this.markEverythingDirty();
      }

      if (!this.cloudinaryEnabled) {
        const cloudinaryState = getCloudinarySetupState();
        this.showToast(`Completa Cloudinary en firebase.js con cloudName y uploadPreset. Carpeta: ${cloudinaryState.folder}`);
      }

      await this.processPendingUploads();
      await this.saveNow({ force: true });
    } catch (error) {
      console.error(error);
      const needsAnonymousAuth = String(error?.code || error?.message || "").includes("configuration-not-found");
      const permissionDenied = String(error?.code || error?.message || "").includes("permission-denied")
        || String(error?.message || "").toLowerCase().includes("insufficient permissions");

      if (permissionDenied && this.user) {
        this.elements.authStateText.textContent = `Invitado ${this.user.uid.slice(0, 8)}`;
        this.elements.cloudStateText.textContent = "Revisa reglas";
        this.elements.recoveryText.textContent = "Firebase permite la sesion, pero Firestore esta bloqueando el libro por reglas.";
        this.setSaveStatus("local", "Guardado local hasta corregir Firestore.");
        this.showToast("Pega las reglas de Firestore del README para activar el guardado en la nube.");
        return;
      }

      this.elements.authStateText.textContent = needsAnonymousAuth ? "Activa Anonymous" : "Error";
      this.elements.cloudStateText.textContent = "Solo respaldo local";
      this.elements.recoveryText.textContent = needsAnonymousAuth
        ? "Activa Anonymous en Firebase Authentication para recuperar este libro desde la nube."
        : "No se pudo abrir la sesion anonima. Tu contenido sigue protegido en localStorage.";
      this.setSaveStatus("local", "Sesion nube no disponible.");
      this.showToast(
        needsAnonymousAuth
          ? "Activa Anonymous en Firebase Authentication."
          : "No se pudo conectar con Firebase. El respaldo local sigue activo.",
      );
    }
  }

  getCloudStateLabel() {
    if (this.firebaseEnabled && this.cloudinaryEnabled) {
      return this.firebasePersistenceEnabled
        ? "Firestore + Cloudinary"
        : "Firestore activo + Cloudinary";
    }

    if (this.firebaseEnabled) {
      return this.firebasePersistenceEnabled
        ? "Firestore listo / Cloudinary pendiente"
        : "Firestore activo / Cloudinary pendiente";
    }

    return "Solo respaldo local";
  }

  selectNewestState(localBackup, remoteState) {
    if (!localBackup && !remoteState) {
      return null;
    }

    if (localBackup && !remoteState) {
      return { source: "local", state: localBackup };
    }

    if (!localBackup && remoteState) {
      return { source: "remote", state: remoteState };
    }

    if (localBackup?.uid && this.user?.uid && localBackup.uid !== this.user.uid) {
      return { source: "remote", state: remoteState };
    }

    const localTime = this.getStateTimestamp(localBackup);
    const remoteTime = this.getStateTimestamp(remoteState);
    return localTime >= remoteTime
      ? { source: "local", state: localBackup }
      : { source: "remote", state: remoteState };
  }

  getStateTimestamp(rawState) {
    if (!rawState) {
      return 0;
    }

    const bookTime = Number(rawState.book?.updatedAtClient || 0);
    const spreadTimes = Array.isArray(rawState.spreads)
      ? rawState.spreads.map((spread) => Number(spread.updatedAtClient || 0))
      : [];
    const uploadTimes = Array.isArray(rawState.pendingUploads)
      ? rawState.pendingUploads.map((upload) => Number(upload.createdAtClient || 0))
      : [];

    return Math.max(bookTime, ...spreadTimes, ...uploadTimes, 0);
  }

  hydrateState(rawState, options = {}) {
    const normalized = this.normalizeState(rawState);
    this.state = normalized.state;
    this.pendingUploads = normalized.pendingUploads;
    this.deletedSpreadIds = new Set();
    this.dirtySpreads = new Set();
    this.dirtyMeta = Boolean(options.markDirty);
    this.currentPageIndex = Math.min(
      normalized.state.book.lastPageIndex || 0,
      this.getTotalPageCountFromState(normalized.state) - 1,
    );
    this.selectedImageId = null;

    if (options.markDirty) {
      this.markEverythingDirty();
    }

    this.renderAll();
    this.persistLocalBackup();
  }

  normalizeState(rawState) {
    const now = Date.now();
    const fallback = this.createDefaultState();
    const incomingBook = rawState?.book || {};
    const incomingSpreads = Array.isArray(rawState?.spreads)
      ? rawState.spreads
      : Array.isArray(rawState?.chapters)
        ? rawState.chapters.map((chapter) => ({
            ...chapter,
            textHtml: chapter.html,
            textPlain: chapter.plainText,
            textWordCount: chapter.wordCount,
            imageItems: [],
          }))
        : [];

    const spreads = incomingSpreads.length
      ? incomingSpreads.map((spread, index) => this.normalizeSpread(spread, index))
      : fallback.spreads;

    return {
      state: {
        book: {
          title: incomingBook.title ?? "",
          subtitle: incomingBook.subtitle ?? "",
          author: incomingBook.author ?? "",
          coverImage: this.normalizeCoverImage(
            incomingBook.coverImage || {
              src: incomingBook.coverImageUrl || "",
              publicId: incomingBook.coverImagePublicId || null,
              assetId: incomingBook.coverImageAssetId || null,
              updatedAtClient: incomingBook.updatedAtClient || now,
            },
          ),
          theme: incomingBook.theme || this.readTheme(),
          lastPageIndex: Number(incomingBook.lastPageIndex || 0),
          createdAtClient: Number(incomingBook.createdAtClient || now),
          updatedAtClient: Number(incomingBook.updatedAtClient || now),
        },
        spreads,
      },
      pendingUploads: Array.isArray(rawState?.pendingUploads) ? rawState.pendingUploads : [],
    };
  }

  normalizeCoverImage(coverImage) {
    const now = Date.now();
    return {
      src: coverImage?.src || "",
      publicId: coverImage?.publicId || null,
      assetId: coverImage?.assetId || null,
      updatedAtClient: Number(coverImage?.updatedAtClient || now),
    };
  }

  normalizeSpread(spread, index) {
    const now = Date.now();
    const incomingHtml = typeof spread.textHtml === "string"
      ? spread.textHtml
      : typeof spread.html === "string"
        ? spread.html
        : "<p><br></p>";
    const incomingPlain = typeof spread.textPlain === "string"
      ? spread.textPlain
      : typeof spread.plainText === "string"
        ? spread.plainText
        : this.htmlToText(incomingHtml);
    const migratedSeed = this.stripSeededSpreadContent(
      typeof spread.title === "string" ? spread.title : "",
      incomingHtml,
      incomingPlain,
      index,
    );
    const imageItems = Array.isArray(spread.imageItems)
      ? spread.imageItems.map((item, itemIndex) => ({
          id: item.id || this.makeId(),
          src: item.src || "",
          x: this.clamp(Number(item.x ?? 8 + itemIndex * 3), 0, 82),
          y: this.clamp(Number(item.y ?? 10 + itemIndex * 3), 0, 82),
          w: this.clamp(Number(item.w ?? 32), IMAGE_MIN_SIZE, 90),
          h: this.clamp(Number(item.h ?? 28), IMAGE_MIN_SIZE, 90),
          z: Number(item.z ?? itemIndex + 1),
        }))
      : [];

    const originalWordCount = Number.isFinite(spread.textWordCount)
      ? spread.textWordCount
      : Number.isFinite(spread.wordCount)
        ? spread.wordCount
        : this.countWords(incomingPlain);
    const migratedWordCount = this.countWords(migratedSeed.textPlain);
    const textWordCount = migratedWordCount !== this.countWords(incomingPlain)
      ? migratedWordCount
      : originalWordCount;

    return {
      id: spread.id || this.makeId(),
      title: migratedSeed.title,
      textHtml: migratedSeed.textHtml,
      textPlain: migratedSeed.textPlain,
      textWordCount,
      pageStyles: this.normalizePageStyles(spread.pageStyles),
      imageItems,
      createdAtClient: Number(spread.createdAtClient || now),
      updatedAtClient: Number(spread.updatedAtClient || now),
    };
  }

  normalizePageStyles(pageStyles) {
    return {
      textColor: this.normalizeHexColor(pageStyles?.textColor, DEFAULT_TEXT_PAGE_COLOR),
      imageColor: this.normalizeHexColor(pageStyles?.imageColor, DEFAULT_IMAGE_PAGE_COLOR),
    };
  }

  stripSeededSpreadContent(title, textHtml, textPlain, index) {
    const normalizedPlain = String(textPlain || "").replace(/\s+/g, " ").trim();
    const normalizedTitle = String(title || "").trim();
    const looksLikeGeneratedTitle = normalizedTitle === `Bloque ${index + 1}`;
    const seededTexts = new Set([
      "Capitulo uno Escribe aqui el texto de esta pagina del libro.",
      "Nueva pagina Escribe el texto de este nuevo bloque.",
      "Escribe aqui el texto de esta pagina.",
    ]);

    if (seededTexts.has(normalizedPlain)) {
      return {
        title: looksLikeGeneratedTitle ? "" : normalizedTitle,
        textHtml: "<p><br></p>",
        textPlain: "",
      };
    }

    if (looksLikeGeneratedTitle && !normalizedPlain) {
      return {
        title: "",
        textHtml,
        textPlain: "",
      };
    }

    return {
      title: normalizedTitle,
      textHtml,
      textPlain: normalizedPlain,
    };
  }

  renderAll() {
    this.elements.bookTitleInput.value = this.state.book.title;
    this.elements.bookSubtitleInput.value = this.state.book.subtitle;
    this.elements.bookAuthorInput.value = this.state.book.author;
    this.updateCoverPreview();
    this.renderSpreadList();
    this.renderCurrentPage();
    this.renderCounters();
    this.updateConnectivityUI();
    this.updateBackupStatus();
    this.applyTheme(this.state.book.theme || this.readTheme());
  }

  renderSpreadList() {
    this.elements.spreadList.innerHTML = "";

    this.state.spreads.forEach((spread, index) => {
      const displayTitle = spread.title || this.getSpreadFallbackTitle(spread);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `spread-card${this.getCurrentPageDescriptor().spread?.id === spread.id ? " active" : ""}`;
      button.innerHTML = `
        <strong>${this.escapeHtml(displayTitle)}</strong>
        <span>Paginas ${index * 2 + 2} y ${index * 2 + 3}</span>
      `;
      button.addEventListener("click", () => {
        void this.navigateToPage(this.getTextPageIndexForSpread(index));
        this.toggleSidebar(false);
      });
      this.elements.spreadList.appendChild(button);
    });
  }

  renderCurrentPage() {
    const descriptor = this.getCurrentPageDescriptor();
    const isCover = descriptor.type === "cover";
    const isText = descriptor.type === "text";
    const isImage = descriptor.type === "image";
    const showEditingChrome = !this.presentationMode && !isCover;

    this.elements.coverView.classList.toggle("hidden", !isCover);
    this.elements.controlStrip.classList.toggle("hidden", !showEditingChrome);
    this.elements.textView.classList.toggle("hidden", !isText);
    this.elements.imageView.classList.toggle("hidden", !isImage);
    this.elements.textTools.classList.toggle("hidden", !isText);
    this.elements.imageTools.classList.toggle("hidden", !isImage);
    this.elements.spreadTitleInput.classList.toggle("hidden", isCover || this.presentationMode);
    this.elements.pageKindLabel.textContent = isCover
      ? "Portada"
      : isText
        ? "Pagina de texto"
        : "Pagina de imagen";
    this.elements.spreadTitleInput.value = descriptor.spread?.title || "";
    this.selectImageFrame(isImage ? this.selectedImageId : null);

    if (isText) {
      this.isHydrating = true;
      this.quill.setContents([]);
      if (descriptor.spread.textHtml && descriptor.spread.textHtml !== "<p><br></p>") {
        this.quill.clipboard.dangerouslyPasteHTML(descriptor.spread.textHtml);
      }
      this.quill.setSelection(this.quill.getLength(), 0, "silent");
      this.isHydrating = false;
    }

    if (isImage) {
      this.renderImageCanvas();
    }

    this.renderLabels();
    this.applyDisplayLabels();
    this.applyCurrentPageTheme();
    this.updatePaletteUI();
    this.renderCounters();
    this.updateNavigationButtons();
    this.updatePresentationUI();
    this.renderSpreadList();
  }

  renderLabels() {
    const descriptor = this.getCurrentPageDescriptor();
    this.elements.pageCounter.textContent = `${this.currentPageIndex + 1} / ${this.getTotalPageCount()}`;

    if (descriptor.type === "cover") {
      this.elements.pageLabel.textContent = "Portada";
      return;
    }

    const spreadNumber = descriptor.spreadIndex + 1;
    this.elements.pageLabel.textContent = `${descriptor.spread.title} · ${descriptor.type === "text" ? "Texto" : "Imagen"} · Bloque ${spreadNumber}`;
  }

  renderCounters() {
    const descriptor = this.getCurrentPageDescriptor();
    const currentWords = descriptor.spread ? descriptor.spread.textWordCount : 0;
    const totalWords = this.state.spreads.reduce((sum, spread) => sum + this.countWords(spread.textPlain), 0);
    this.elements.wordCount.textContent = String(currentWords);
    this.elements.totalWordCount.textContent = String(totalWords);
  }

  applyDisplayLabels() {
    const descriptor = this.getCurrentPageDescriptor();
    if (descriptor.type === "cover" || !descriptor.spread) {
      return;
    }

    const displayTitle = descriptor.spread.title || this.getSpreadFallbackTitle(descriptor.spread);
    const spreadNumber = descriptor.spreadIndex + 1;
    this.elements.pageLabel.textContent = `${displayTitle} - ${descriptor.type === "text" ? "Texto" : "Imagen"} - Bloque ${spreadNumber}`;
  }

  applyCurrentPageTheme() {
    const descriptor = this.getCurrentPageDescriptor();
    const defaultTextBackground = "linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(255, 255, 255, 0.9))";
    const defaultImageBackground = `
      linear-gradient(180deg, rgba(239, 250, 255, 0.92), rgba(248, 253, 255, 0.98)),
      repeating-linear-gradient(
        0deg,
        transparent,
        transparent 31px,
        rgba(62, 180, 255, 0.06) 32px
      )
    `;

    this.elements.textView.style.removeProperty("--page-tone");
    this.elements.imageView.style.removeProperty("--page-tone");
    this.elements.textView.style.background = "";
    this.elements.imageView.style.background = "";
    this.elements.textEditor.style.background = defaultTextBackground;
    this.elements.imageCanvas.style.background = defaultImageBackground;

    if (!descriptor.spread) {
      return;
    }

    const styles = descriptor.spread.pageStyles || this.normalizePageStyles();
    if (descriptor.type === "text") {
      const color = styles.textColor || DEFAULT_TEXT_PAGE_COLOR;
      const pageBackground = `
        linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0.92)),
        linear-gradient(135deg, ${this.hexToRgba(color, 0.52)}, ${this.hexToRgba(color, 0.84)})
      `;
      this.elements.textView.style.setProperty("--page-tone", color);
      this.elements.textView.style.background = pageBackground;
      this.elements.textEditor.style.background = pageBackground;
      return;
    }

    if (descriptor.type === "image") {
      const color = styles.imageColor || DEFAULT_IMAGE_PAGE_COLOR;
      const pageBackground = `
        linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.02)),
        linear-gradient(180deg, ${this.hexToRgba(color, 0.96)}, ${this.hexToRgba(color, 0.82)})
      `;
      this.elements.imageView.style.setProperty("--page-tone", color);
      this.elements.imageView.style.background = pageBackground;
      this.elements.imageCanvas.style.background = pageBackground;
    }
  }

  updatePaletteUI() {
    const descriptor = this.getCurrentPageDescriptor();
    const allowPalette = descriptor.type === "text" || descriptor.type === "image";
    const pageColor = this.getCurrentPageColor();

    this.elements.paletteToggleButton.disabled = !allowPalette;
    this.elements.paletteToggleButton.textContent = this.paletteOpen && allowPalette ? "Cerrar paleta" : "Paleta";
    this.elements.palettePanel.classList.toggle("hidden", !allowPalette || !this.paletteOpen);
    this.elements.paletteDot.style.background = allowPalette ? pageColor : "transparent";

    if (!allowPalette) {
      return;
    }

    const label = descriptor.type === "text" ? "Color pagina de texto" : "Color pagina de imagen";
    this.elements.palettePreviewLabel.textContent = label;
    this.elements.paletteHexText.textContent = pageColor.toUpperCase();
    this.elements.paletteColorInput.value = pageColor.toLowerCase();
    this.elements.palettePanel.style.background = pageColor;
    this.elements.palettePreview.style.background = `
      linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(0, 0, 0, 0.88)),
      linear-gradient(90deg, rgba(255, 255, 255, 0.94), ${pageColor}, #1b9dff)
    `;

    this.elements.paletteStrip.querySelectorAll(".palette-swatch").forEach((button) => {
      const swatchColor = button.dataset.color || DEFAULT_TEXT_PAGE_COLOR;
      button.style.background = swatchColor;
      button.classList.toggle("active", swatchColor.toLowerCase() === pageColor.toLowerCase());
    });
  }

  togglePalettePanel(forceState) {
    const descriptor = this.getCurrentPageDescriptor();
    if (!(descriptor.type === "text" || descriptor.type === "image")) {
      return;
    }

    this.paletteOpen = typeof forceState === "boolean" ? forceState : !this.paletteOpen;
    this.updatePaletteUI();
  }

  getCurrentPageColor() {
    const descriptor = this.getCurrentPageDescriptor();
    if (!descriptor.spread) {
      return DEFAULT_TEXT_PAGE_COLOR;
    }

    const styles = descriptor.spread.pageStyles || this.normalizePageStyles();
    return descriptor.type === "image"
      ? styles.imageColor || DEFAULT_IMAGE_PAGE_COLOR
      : styles.textColor || DEFAULT_TEXT_PAGE_COLOR;
  }

  applyCurrentPageColor(colorValue) {
    const descriptor = this.getCurrentPageDescriptor();
    if (!(descriptor.type === "text" || descriptor.type === "image") || !descriptor.spread) {
      return;
    }

    const fallback = descriptor.type === "image" ? DEFAULT_IMAGE_PAGE_COLOR : DEFAULT_TEXT_PAGE_COLOR;
    const normalizedColor = this.normalizeHexColor(colorValue, fallback);
    descriptor.spread.pageStyles = descriptor.spread.pageStyles || this.normalizePageStyles();

    if (descriptor.type === "image") {
      descriptor.spread.pageStyles.imageColor = normalizedColor;
    } else {
      descriptor.spread.pageStyles.textColor = normalizedColor;
    }

    descriptor.spread.updatedAtClient = Date.now();
    this.touchBook();
    this.markSpreadDirty(descriptor.spread.id);
    this.applyCurrentPageTheme();
    this.updatePaletteUI();
    this.persistLocalBackup();
    this.queueSave();
  }

  resetCurrentPageColor() {
    const descriptor = this.getCurrentPageDescriptor();
    if (!(descriptor.type === "text" || descriptor.type === "image")) {
      return;
    }

    this.applyCurrentPageColor(
      descriptor.type === "image" ? DEFAULT_IMAGE_PAGE_COLOR : DEFAULT_TEXT_PAGE_COLOR,
    );
  }

  downloadAsPdf() {
    this.captureCurrentTextPage();
    document.getElementById("printFrame")?.remove();
    const printFrame = document.createElement("iframe");
    printFrame.id = "printFrame";
    printFrame.className = "print-frame";
    printFrame.setAttribute("aria-hidden", "true");
    document.body.appendChild(printFrame);
    const markup = this.buildPrintDocument();
    const frameWindow = printFrame.contentWindow;
    const frameDocument = frameWindow?.document;

    if (!frameDocument || !frameWindow) {
      printFrame.remove();
      this.showToast("No se pudo preparar la impresion.");
      return;
    }

    const openPrintDialog = () => {
      window.setTimeout(() => {
        try {
          frameWindow.focus();
          frameWindow.print();
        } catch (error) {
          console.error(error);
          this.showToast("El navegador no pudo abrir la impresion.");
        }
      }, 320);
    };

    frameDocument.open();
    frameDocument.write(markup);
    frameDocument.close();

    if (frameDocument.readyState === "complete") {
      openPrintDialog();
    } else {
      printFrame.addEventListener("load", openPrintDialog, { once: true });
    }

    window.setTimeout(() => {
      printFrame.remove();
    }, 120000);
    this.showToast("Libro listo: guarda como PDF en horizontal. Para librito fisico, activa impresion a doble cara.");
  }

  buildPrintDocument() {
    const spreadMarkup = this.state.spreads.map((spread, index) => {
      const title = this.escapeHtml(spread.title || this.getSpreadFallbackTitle(spread));
      const textColor = this.normalizeHexColor(spread.pageStyles?.textColor, DEFAULT_TEXT_PAGE_COLOR);
      const imageColor = this.normalizeHexColor(spread.pageStyles?.imageColor, DEFAULT_IMAGE_PAGE_COLOR);
      const pageNumberText = index * 2 + 2;
      const pageNumberImage = index * 2 + 3;

      return `
        <section class="print-spread">
          <article class="print-page print-text" style="--sheet-color:${textColor}">
            <div class="print-page-number is-left">${pageNumberText}</div>
            <header class="print-sheet-head">
              <span>Texto</span>
              <strong>${title}</strong>
            </header>
            <div class="print-rich-text">
              ${spread.textHtml || "<p></p>"}
            </div>
          </article>
          <div class="print-spine" aria-hidden="true"></div>
          <article class="print-page print-image" style="--sheet-color:${imageColor}">
            <div class="print-page-number is-right">${pageNumberImage}</div>
            <header class="print-sheet-head">
              <span>Imagen</span>
              <strong>${title}</strong>
            </header>
            <div class="print-image-board">
              ${(spread.imageItems || []).map((item) => `
                <div class="print-image-frame" style="left:${item.x}%;top:${item.y}%;width:${item.w}%;height:${item.h}%;">
                  ${item.src ? `<img src="${this.escapeAttribute(item.src)}" alt="Imagen del libro">` : ""}
                </div>
              `).join("")}
            </div>
          </article>
        </section>
      `;
    }).join("");

    const coverImage = this.state.book.coverImage?.src
      ? `background-image: linear-gradient(180deg, rgba(5, 8, 15, 0.1), rgba(5, 8, 15, 0.82)), url('${this.escapeAttribute(this.state.book.coverImage.src)}');`
      : "background-image: linear-gradient(160deg, #03070e 8%, #0b1830 48%, #47bff7 78%, #ffd84d 100%);";

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(this.state.book.title || "Libro tati")}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    @page {
      size: A4 landscape;
      margin: 10mm;
    }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Manrope", sans-serif;
      color: #07111d;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-cover,
    .print-spread {
      page-break-after: always;
      break-after: page;
    }
    .print-cover:last-child,
    .print-spread:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .print-cover {
      min-height: 190mm;
      padding: 14mm;
      display: flex;
      align-items: flex-end;
      background-size: cover;
      background-position: center;
      color: #ffffff;
      border-radius: 18px;
      overflow: hidden;
    }
    .print-cover-card {
      width: 100%;
      min-height: 160mm;
      border-radius: 18px;
      padding: 16mm;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      gap: 8mm;
      background: rgba(5, 8, 15, 0.16);
      backdrop-filter: blur(2px);
    }
    .print-cover-card h1 {
      margin: 0;
      font-family: "Cormorant Garamond", serif;
      font-size: 34pt;
      line-height: 0.95;
    }
    .print-cover-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8mm;
    }
    .print-cover-pill {
      padding: 4mm 6mm;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.16);
      font-size: 10pt;
      font-weight: 700;
    }
    .print-spread {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 5mm minmax(0, 1fr);
      gap: 0;
      min-height: 190mm;
      align-items: stretch;
    }
    .print-spine {
      border-radius: 999px;
      background: linear-gradient(
        90deg,
        rgba(7, 17, 29, 0.04),
        rgba(7, 17, 29, 0.16),
        rgba(7, 17, 29, 0.04)
      );
      box-shadow: inset 0 0 0 1px rgba(7, 17, 29, 0.08);
    }
    .print-page {
      position: relative;
      min-height: 190mm;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(7, 17, 29, 0.08);
      background: #ffffff;
    }
    .print-page-number {
      position: absolute;
      bottom: 10mm;
      font-size: 10pt;
      font-weight: 700;
      color: rgba(7, 17, 29, 0.68);
      z-index: 2;
    }
    .print-page-number.is-left { left: 10mm; }
    .print-page-number.is-right { right: 10mm; }
    .print-sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6mm;
      padding: 8mm 9mm 0;
      font-size: 10pt;
    }
    .print-sheet-head span {
      padding: 2.5mm 4.5mm;
      border-radius: 999px;
      background: rgba(7, 17, 29, 0.08);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 8pt;
    }
    .print-sheet-head strong {
      font-family: "Cormorant Garamond", serif;
      font-size: 15pt;
      text-align: right;
    }
    .print-text {
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.92)),
        linear-gradient(135deg, var(--sheet-color), #ffffff);
    }
    .print-rich-text {
      padding: 6mm 9mm 14mm;
      font-size: 11pt;
      line-height: 1.6;
    }
    .print-rich-text h1, .print-rich-text h2, .print-rich-text h3 {
      font-family: "Cormorant Garamond", serif;
    }
    .print-image {
      background: linear-gradient(180deg, var(--sheet-color), #ffffff);
    }
    .print-image-board {
      position: relative;
      height: calc(190mm - 24mm);
      margin: 6mm 9mm 12mm;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.3);
      overflow: hidden;
    }
    .print-image-frame {
      position: absolute;
      border-radius: 12px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.52);
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.08);
    }
    .print-image-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  </style>
</head>
<body>
  <section class="print-cover" style="${coverImage}">
    <div class="print-cover-card">
      <h1>${this.escapeHtml(this.state.book.title || " ")}</h1>
      <div class="print-cover-meta">
        ${this.state.book.subtitle ? `<div class="print-cover-pill">Materia: ${this.escapeHtml(this.state.book.subtitle)}</div>` : ""}
        ${this.state.book.author ? `<div class="print-cover-pill">Carnet: ${this.escapeHtml(this.state.book.author)}</div>` : ""}
      </div>
    </div>
  </section>
  ${spreadMarkup}
</body>
</html>`;
  }

  renderImageCanvas() {
    const spread = this.getCurrentSpread();
    this.elements.imageCanvas.innerHTML = "";

    const hint = document.createElement("div");
    hint.className = "image-canvas-hint";
    hint.id = "imageCanvasHint";
    hint.textContent = "";
    hint.classList.toggle("hidden", Boolean(spread?.imageItems.length));
    this.elements.imageCanvas.appendChild(hint);

    if (!spread) {
      return;
    }

    const items = [...spread.imageItems].sort((left, right) => left.z - right.z);

    for (const item of items) {
      const frame = document.createElement("div");
      frame.className = `image-frame${item.src ? "" : " empty"}${item.id === this.selectedImageId ? " selected" : ""}`;
      frame.dataset.imageId = item.id;
      this.applyFrameStyle(frame, item);
      frame.innerHTML = `
        <div class="image-inner">
          ${item.src
            ? `<img src="${this.escapeAttribute(item.src)}" alt="Imagen del libro">`
            : `<div class="image-placeholder"></div>`}
        </div>
        <div class="frame-toolbar">Mover</div>
        <div class="resize-handle" aria-hidden="true"></div>
      `;
      this.elements.imageCanvas.appendChild(frame);
    }
  }

  applyFrameStyle(frame, item) {
    frame.style.left = `${item.x}%`;
    frame.style.top = `${item.y}%`;
    frame.style.width = `${item.w}%`;
    frame.style.height = `${item.h}%`;
    frame.style.zIndex = String(item.z);
  }

  updateNavigationButtons() {
    this.elements.prevPageButton.disabled = this.currentPageIndex <= 0 || this.isAnimating;
    this.elements.nextPageButton.disabled = this.currentPageIndex >= this.getTotalPageCount() - 1 || this.isAnimating;
  }

  updateCoverPreview() {
    const hasCoverImage = Boolean(this.state.book.coverImage?.src);
    this.elements.coverTitlePreview.textContent = this.state.book.title;
    this.elements.coverSubtitlePreview.textContent = this.state.book.subtitle;
    this.elements.coverAuthorPreview.textContent = this.state.book.author;
    this.elements.coverImagePreview.src = hasCoverImage ? this.state.book.coverImage.src : "";
    this.elements.coverImagePreview.classList.toggle("has-image", hasCoverImage);
    this.elements.coverSubjectLine.classList.toggle("hidden", !this.state.book.subtitle);
    this.elements.coverAuthorLine.classList.toggle("hidden", !this.state.book.author);
    this.elements.coverImageEmpty.classList.toggle("hidden", hasCoverImage);
    this.elements.coverCard.classList.toggle("has-image", hasCoverImage);
    this.elements.removeCoverImageButton.disabled = !hasCoverImage;
    this.elements.coverCard.classList.toggle(
      "is-empty",
      !this.state.book.title && !this.state.book.subtitle && !this.state.book.author && !hasCoverImage,
    );
  }

  updateConnectivityUI() {
    this.elements.connectivityText.textContent = navigator.onLine ? "En linea" : "Sin conexion";
  }

  updateBackupStatus() {
    this.elements.backupStateText.textContent = this.pendingUploads.length
      ? `Pendientes: ${this.pendingUploads.length}`
      : "Listo";
  }

  handleMetaChange() {
    this.touchBook();
    this.updateCoverPreview();
    this.renderLabels();
    this.persistLocalBackup();
    this.queueSave();
  }

  getCurrentPageDescriptor() {
    if (this.currentPageIndex === 0) {
      return {
        type: "cover",
        spreadIndex: -1,
        spread: null,
      };
    }

    const sequenceIndex = this.currentPageIndex - 1;
    const spreadIndex = Math.floor(sequenceIndex / 2);
    const type = sequenceIndex % 2 === 0 ? "text" : "image";
    return {
      type,
      spreadIndex,
      spread: this.state.spreads[spreadIndex] || null,
    };
  }

  getCurrentSpread() {
    return this.getCurrentPageDescriptor().spread;
  }

  getTextPageIndexForSpread(spreadIndex) {
    return 1 + spreadIndex * 2;
  }

  getImagePageIndexForSpread(spreadIndex) {
    return 2 + spreadIndex * 2;
  }

  getTotalPageCount() {
    return this.getTotalPageCountFromState(this.state);
  }

  getTotalPageCountFromState(state) {
    return 1 + state.spreads.length * 2;
  }

  async navigateToPage(targetIndex) {
    if (this.isAnimating || targetIndex < 0 || targetIndex >= this.getTotalPageCount() || targetIndex === this.currentPageIndex) {
      return;
    }

    this.captureCurrentTextPage();
    this.isAnimating = true;
    this.updateNavigationButtons();

    const direction = targetIndex > this.currentPageIndex ? "next" : "prev";
    const turnClass = direction === "next" ? "turn-next" : "turn-prev";
    const arriveClass = direction === "next" ? "arrive-next" : "arrive-prev";

    this.elements.bookPage.classList.add(turnClass);
    await this.wait(210);

    this.currentPageIndex = targetIndex;
    this.state.book.lastPageIndex = targetIndex;
    this.touchBook();
    this.renderCurrentPage();
    this.persistLocalBackup();
    this.queueSave();

    this.elements.bookPage.classList.remove(turnClass);
    this.elements.bookPage.classList.add(arriveClass);
    await this.wait(330);
    this.elements.bookPage.classList.remove(arriveClass);

    this.isAnimating = false;
    this.updateNavigationButtons();
  }

  addSpread() {
    this.captureCurrentTextPage();
    const now = Date.now();
    const spread = {
      id: this.makeId(),
      title: "",
      textHtml: "<p><br></p>",
      textPlain: "",
      textWordCount: 0,
      pageStyles: {
        textColor: DEFAULT_TEXT_PAGE_COLOR,
        imageColor: DEFAULT_IMAGE_PAGE_COLOR,
      },
      imageItems: [],
      createdAtClient: now,
      updatedAtClient: now,
    };

    this.state.spreads.push(spread);
    this.touchBook();
    this.markSpreadDirty(spread.id);
    this.currentPageIndex = this.getTextPageIndexForSpread(this.state.spreads.length - 1);
    this.state.book.lastPageIndex = this.currentPageIndex;
    this.renderAll();
    this.persistLocalBackup();
    this.queueSave();
    this.showToast("Nuevo bloque creado: una pagina de texto y otra de imagen.");
  }

  deleteCurrentSpread() {
    const descriptor = this.getCurrentPageDescriptor();
    if (!descriptor.spread) {
      this.showToast("La portada no se puede eliminar.");
      return;
    }

    if (this.state.spreads.length <= 1) {
      this.showToast("Tu libro necesita al menos un bloque.");
      return;
    }

    const spreadLabel = descriptor.spread.title || this.getSpreadFallbackTitle(descriptor.spread);
    const confirmed = window.confirm(`Eliminar "${spreadLabel}"?`);
    if (!confirmed) {
      return;
    }

    const index = descriptor.spreadIndex;
    this.state.spreads.splice(index, 1);
    this.deletedSpreadIds.add(descriptor.spread.id);
    this.pendingUploads = this.pendingUploads.filter((upload) => upload.spreadId !== descriptor.spread.id);
    this.selectedImageId = null;
    this.currentPageIndex = index === 0 ? 0 : this.getTextPageIndexForSpread(index - 1);
    this.state.book.lastPageIndex = this.currentPageIndex;
    this.touchBook();
    this.renderAll();
    this.persistLocalBackup();
    this.queueSave();
    this.showToast("Bloque eliminado.");
  }

  captureCurrentTextPage() {
    const descriptor = this.getCurrentPageDescriptor();
    if (descriptor.type !== "text" || !descriptor.spread || this.isHydrating) {
      return;
    }

    descriptor.spread.textHtml = this.quill.root.innerHTML;
    descriptor.spread.textPlain = this.quill.getText().trim();
    descriptor.spread.textWordCount = this.countWords(descriptor.spread.textPlain);
    descriptor.spread.updatedAtClient = Date.now();
  }

  addImageFrame() {
    const spread = this.getCurrentSpread();
    if (!spread || this.getCurrentPageDescriptor().type !== "image") {
      this.showToast("Ve a una pagina de imagen para agregar cuadros.");
      return;
    }

    const item = this.createImageFrame(spread.imageItems.length);
    spread.imageItems.push(item);
    spread.updatedAtClient = Date.now();
    this.touchBook();
    this.markSpreadDirty(spread.id);
    this.selectedImageId = item.id;
    this.renderImageCanvas();
    this.persistLocalBackup();
    this.queueSave();
    this.showToast("Cuadro de imagen creado. Haz clic en el y pega una imagen.");
  }

  createImageFrame(index = 0) {
    return {
      id: this.makeId(),
      src: "",
      x: this.clamp(8 + index * 4, 4, 76),
      y: this.clamp(10 + index * 3, 4, 76),
      w: 34,
      h: 28,
      z: index + 1,
    };
  }

  removeSelectedImageFrame() {
    const spread = this.getCurrentSpread();
    if (!spread || !this.selectedImageId) {
      this.showToast("Selecciona un cuadro de imagen primero.");
      return;
    }

    spread.imageItems = spread.imageItems.filter((item) => item.id !== this.selectedImageId);
    this.pendingUploads = this.pendingUploads.filter((upload) => upload.imageId !== this.selectedImageId);
    spread.updatedAtClient = Date.now();
    this.selectedImageId = null;
    this.touchBook();
    this.markSpreadDirty(spread.id);
    this.renderImageCanvas();
    this.persistLocalBackup();
    this.queueSave();
  }

  bringSelectedImageForward() {
    const spread = this.getCurrentSpread();
    if (!spread || !this.selectedImageId) {
      this.showToast("Selecciona un cuadro de imagen primero.");
      return;
    }

    const item = spread.imageItems.find((entry) => entry.id === this.selectedImageId);
    if (!item) {
      return;
    }

    const maxZ = Math.max(...spread.imageItems.map((entry) => entry.z), 0);
    item.z = maxZ + 1;
    spread.updatedAtClient = Date.now();
    this.touchBook();
    this.markSpreadDirty(spread.id);
    this.renderImageCanvas();
    this.persistLocalBackup();
    this.queueSave();
  }

  selectImageFrame(imageId) {
    this.selectedImageId = imageId;
    const spread = this.getCurrentSpread();
    if (!spread || this.getCurrentPageDescriptor().type !== "image") {
      return;
    }

    for (const frame of this.elements.imageCanvas.querySelectorAll(".image-frame")) {
      frame.classList.toggle("selected", frame.dataset.imageId === imageId);
    }
  }

  handleCanvasPointerDown(event) {
    const descriptor = this.getCurrentPageDescriptor();
    if (descriptor.type !== "image") {
      return;
    }

    const frame = event.target.closest(".image-frame");
    if (!frame) {
      return;
    }

    const spread = descriptor.spread;
    const imageId = frame.dataset.imageId;
    const item = spread.imageItems.find((entry) => entry.id === imageId);
    if (!item) {
      return;
    }

    const mode = event.target.closest(".resize-handle") ? "resize" : "drag";
    const rect = this.elements.imageCanvas.getBoundingClientRect();
    this.selectImageFrame(imageId);
    this.interaction = {
      mode,
      spreadId: spread.id,
      imageId,
      rect,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: item.x,
      startY: item.y,
      startW: item.w,
      startH: item.h,
    };

    window.addEventListener("pointermove", this.boundPointerMove);
    window.addEventListener("pointerup", this.boundPointerUp);
    event.preventDefault();
  }

  handlePointerMove(event) {
    if (!this.interaction) {
      return;
    }

    const spread = this.getCurrentSpread();
    if (!spread || spread.id !== this.interaction.spreadId) {
      return;
    }

    const item = spread.imageItems.find((entry) => entry.id === this.interaction.imageId);
    if (!item) {
      return;
    }

    const dx = ((event.clientX - this.interaction.startClientX) / this.interaction.rect.width) * 100;
    const dy = ((event.clientY - this.interaction.startClientY) / this.interaction.rect.height) * 100;

    if (this.interaction.mode === "drag") {
      item.x = this.clamp(this.interaction.startX + dx, 0, 100 - item.w);
      item.y = this.clamp(this.interaction.startY + dy, 0, 100 - item.h);
    } else {
      item.w = this.clamp(this.interaction.startW + dx, IMAGE_MIN_SIZE, 100 - item.x);
      item.h = this.clamp(this.interaction.startH + dy, IMAGE_MIN_SIZE, 100 - item.y);
    }

    const frame = this.elements.imageCanvas.querySelector(`.image-frame[data-image-id="${item.id}"]`);
    if (frame) {
      this.applyFrameStyle(frame, item);
    }
  }

  handlePointerUp() {
    if (!this.interaction) {
      return;
    }

    const spread = this.getCurrentSpread();
    if (spread) {
      spread.updatedAtClient = Date.now();
      this.touchBook();
      this.markSpreadDirty(spread.id);
      this.persistLocalBackup();
      this.queueSave();
    }

    this.interaction = null;
    window.removeEventListener("pointermove", this.boundPointerMove);
    window.removeEventListener("pointerup", this.boundPointerUp);
  }

  async attachCoverImage(file) {
    if (!file?.type?.startsWith("image/")) {
      this.showToast("Selecciona una imagen valida para la portada.");
      return;
    }

    const dataUrl = await this.fileToDataUrl(file);
    this.state.book.coverImage = {
      ...(this.state.book.coverImage || {}),
      src: dataUrl,
      updatedAtClient: Date.now(),
    };

    this.pendingUploads = this.pendingUploads.filter((upload) => upload.kind !== "cover");
    this.pendingUploads.push({
      id: this.makeId(),
      kind: "cover",
      fileName: file.name || `portada-${Date.now()}.png`,
      mimeType: file.type || "image/png",
      dataUrl,
      createdAtClient: Date.now(),
    });

    this.touchBook();
    this.updateCoverPreview();
    this.persistLocalBackup();
    this.updateBackupStatus();
    this.elements.recoveryText.textContent = "La portada se respalda en local y se sube automaticamente a Cloudinary.";
    this.showToast("Imagen de portada agregada.");

    await this.processPendingUploads();
    this.queueSave();
  }

  removeCoverImage() {
    if (!this.state.book.coverImage?.src) {
      this.showToast("La portada aun no tiene imagen.");
      return;
    }

    this.state.book.coverImage = this.normalizeCoverImage({ src: "" });
    this.pendingUploads = this.pendingUploads.filter((upload) => upload.kind !== "cover");
    this.touchBook();
    this.updateCoverPreview();
    this.persistLocalBackup();
    this.updateBackupStatus();
    this.queueSave();
    this.showToast("Imagen de portada eliminada.");
  }

  async attachImagesToCurrentPage(files) {
    const spread = this.getCurrentSpread();
    if (!spread || this.getCurrentPageDescriptor().type !== "image") {
      this.showToast("Ve a una pagina de imagen para pegar fotos.");
      return;
    }

    let firstAssignment = true;

    for (const file of files) {
      const dataUrl = await this.fileToDataUrl(file);
      let target = spread.imageItems.find((item) => item.id === this.selectedImageId);

      if (!target || (target.src && !firstAssignment)) {
        target = this.createImageFrame(spread.imageItems.length);
        spread.imageItems.push(target);
      }

      target.src = dataUrl;
      target.z = Math.max(...spread.imageItems.map((item) => item.z), 0) + 1;
      this.selectedImageId = target.id;

      this.pendingUploads = this.pendingUploads.filter((upload) => upload.imageId !== target.id);
      this.pendingUploads.push({
        id: this.makeId(),
        spreadId: spread.id,
        imageId: target.id,
        fileName: file.name || `imagen-${Date.now()}.png`,
        mimeType: file.type || "image/png",
        dataUrl,
        createdAtClient: Date.now(),
      });

      firstAssignment = false;
    }

    spread.updatedAtClient = Date.now();
    this.touchBook();
    this.markSpreadDirty(spread.id);
    this.renderImageCanvas();
    this.persistLocalBackup();
    this.updateBackupStatus();
    this.elements.recoveryText.textContent = "Las imagenes se respaldan localmente y se suben automaticamente a Cloudinary.";
    this.showToast("Imagen agregada. Puedes moverla o cambiar su tamano.");

    await this.processPendingUploads();
    this.queueSave();
  }

  extractImagesFromClipboard(clipboardData) {
    if (!clipboardData?.items) {
      return [];
    }

    return Array.from(clipboardData.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }

  async processPendingUploads() {
    if (!this.pendingUploads.length || !this.cloudinaryEnabled || !navigator.onLine) {
      this.updateBackupStatus();
      return;
    }

    const remaining = [];

    for (const upload of this.pendingUploads) {
      if (upload.kind === "cover") {
        try {
          this.setSaveStatus("saving", "Subiendo portada...");
          const file = this.dataUrlToFile(upload.dataUrl, upload.fileName, upload.mimeType);
          const result = await uploadImageToCloudinary({
            file,
            uid: this.user?.uid || "anonimo",
            spreadId: "portada",
            imageId: "cover-image",
          });
          this.state.book.coverImage = {
            src: result.secureUrl,
            publicId: result.publicId,
            assetId: result.assetId,
            updatedAtClient: Date.now(),
          };
          this.touchBook();
          this.updateCoverPreview();
        } catch (error) {
          console.error("No se pudo subir la portada.", error);
          remaining.push(upload);
        }

        continue;
      }

      const spread = this.state.spreads.find((entry) => entry.id === upload.spreadId);
      const imageItem = spread?.imageItems.find((item) => item.id === upload.imageId);

      if (!spread || !imageItem) {
        continue;
      }

      try {
        this.setSaveStatus("saving", "Subiendo imagen...");
        const file = this.dataUrlToFile(upload.dataUrl, upload.fileName, upload.mimeType);
        const result = await uploadImageToCloudinary({
          file,
          uid: this.user?.uid || "anonimo",
          spreadId: upload.spreadId,
          imageId: upload.imageId,
        });
        imageItem.src = result.secureUrl;
        spread.updatedAtClient = Date.now();
        this.touchBook();
        this.markSpreadDirty(spread.id);
      } catch (error) {
        console.error("No se pudo subir la imagen.", error);
        remaining.push(upload);
      }
    }

    this.pendingUploads = remaining;
    this.updateBackupStatus();
    this.persistLocalBackup();

    if (!remaining.length && this.getCurrentPageDescriptor().type === "image") {
      this.renderImageCanvas();
      this.elements.recoveryText.textContent = "Todo el libro, incluyendo imagenes, esta sincronizado entre Firestore, Cloudinary y el respaldo local.";
    }

    if (!remaining.length && this.getCurrentPageDescriptor().type === "cover") {
      this.elements.recoveryText.textContent = "La portada y las paginas estan sincronizadas entre Firestore, Cloudinary y el respaldo local.";
    }
  }

  async saveNow(options = {}) {
    this.captureCurrentTextPage();
    this.persistLocalBackup();

    if (this.isSaving) {
      return;
    }

    if (!this.hasPendingChanges() && !options.force) {
      this.setSaveStatus("saved", "Guardado");
      return;
    }

    if (this.pendingUploads.length && !this.cloudinaryEnabled) {
      this.setSaveStatus("local", "Configura Cloudinary para subir imagenes.");
      return;
    }

    if (this.pendingUploads.length && !navigator.onLine) {
      this.setSaveStatus("offline", "Sin conexion. Imagenes pendientes en local.");
      return;
    }

    await this.processPendingUploads();

    if (this.pendingUploads.length) {
      this.setSaveStatus("local", "Esperando subir imagenes antes de guardar.");
      return;
    }

    if (!this.firebaseEnabled || !this.user) {
      this.setSaveStatus("local", "Solo respaldo local por ahora.");
      return;
    }

    if (!navigator.onLine) {
      this.setSaveStatus("offline", "Sin conexion. Respaldo local activo.");
      return;
    }

    this.isSaving = true;
    this.setSaveStatus("saving", "Guardando...");

    try {
      const payload = {
        book: {
          ...this.state.book,
          spreadOrder: this.state.spreads.map((spread) => spread.id),
          lastPageIndex: this.currentPageIndex,
        },
        spreads: this.state.spreads,
        deletedSpreadIds: [...this.deletedSpreadIds],
      };

      await saveRemoteBook(this.user.uid, payload);
      this.dirtyMeta = false;
      this.dirtySpreads.clear();
      this.deletedSpreadIds.clear();
      this.state.book.updatedAtClient = Date.now();
      this.persistLocalBackup();
      this.setSaveStatus("saved", "Guardado");
      this.elements.lastSavedText.textContent = `Ultimo guardado en la nube: ${this.formatDateTime(new Date())}`;
    } catch (error) {
      console.error(error);
      this.setSaveStatus("error", "Error al guardar");
      this.showToast("No se pudo guardar en Firestore. El respaldo local sigue activo.");
    } finally {
      this.isSaving = false;
    }
  }

  hasPendingChanges() {
    return this.dirtyMeta || this.dirtySpreads.size > 0 || this.deletedSpreadIds.size > 0 || this.pendingUploads.length > 0;
  }

  touchBook() {
    this.state.book.updatedAtClient = Date.now();
    this.dirtyMeta = true;
    this.setSaveStatus("saving", "Guardando...");
  }

  markSpreadDirty(spreadId) {
    if (spreadId) {
      this.dirtySpreads.add(spreadId);
    }
  }

  markEverythingDirty() {
    this.dirtyMeta = true;
    this.state.spreads.forEach((spread) => this.dirtySpreads.add(spread.id));
  }

  queueSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  startAutosaveLoop() {
    this.intervalHandle = window.setInterval(() => {
      if (this.hasPendingChanges()) {
        void this.saveNow();
      }
    }, SAVE_INTERVAL_MS);
  }

  setSaveStatus(state, label) {
    this.elements.saveStatusChip.dataset.state = state;
    this.elements.saveStatusText.textContent = label;
  }

  getLocalBackup() {
    try {
      const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("No se pudo leer el respaldo local.", error);
      return null;
    }
  }

  persistLocalBackup() {
    const snapshot = {
      book: {
        ...this.state.book,
        lastPageIndex: this.currentPageIndex,
      },
      spreads: this.state.spreads,
      pendingUploads: this.pendingUploads,
      uid: this.user?.uid || null,
    };

    try {
      localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.error("No se pudo guardar el respaldo local.", error);
      this.showToast("El navegador no pudo ampliar el respaldo local.");
    }
  }

  toggleSidebar(forceOpen) {
    const open = typeof forceOpen === "boolean" ? forceOpen : !this.sidebarOpen;
    this.sidebarOpen = open;
    this.elements.sidebar.classList.toggle("open", open);
    this.elements.sidebarBackdrop.classList.toggle("show", open);
  }

  updatePresentationLabels() {
    const cleanLabel = (this.elements.pageLabel.textContent || "Portada")
      .replaceAll("Â·", "-")
      .replaceAll("·", "-");
    this.elements.pageLabel.textContent = cleanLabel;
    this.elements.presentationPageLabel.textContent = cleanLabel;
    this.elements.presentationPageCounter.textContent = this.elements.pageCounter.textContent || "1 / 1";
  }

  canUseFullscreen() {
    return typeof document.documentElement.requestFullscreen === "function"
      || typeof document.body?.requestFullscreen === "function";
  }

  updatePresentationUI() {
    const isFullscreen = Boolean(document.fullscreenElement);
    const supportsFullscreen = this.canUseFullscreen();
    document.body.classList.toggle("presentation-mode", this.presentationMode);
    this.elements.presentationModeButton.textContent = this.presentationMode ? "Presentando" : "Presentar";
    this.elements.presentationModeButton.disabled = this.presentationMode;
    this.elements.fullscreenToggleButton.textContent = supportsFullscreen
      ? (isFullscreen ? "Salir de pantalla completa" : "Pantalla completa")
      : "Usar F11";
    this.quill?.enable(!this.presentationMode);
    if (this.presentationMode) {
      this.paletteOpen = false;
    }
    this.updatePaletteUI();
    this.updatePresentationLabels();
  }

  async togglePresentationMode(forceState) {
    const nextState = typeof forceState === "boolean" ? forceState : !this.presentationMode;
    if (nextState === this.presentationMode) {
      return;
    }

    this.captureCurrentTextPage();
    this.presentationMode = nextState;

    if (nextState) {
      this.toggleSidebar(false);
      this.showToast("Modo presentacion activado.");
    } else {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch (error) {
          console.error(error);
        }
      }

      this.showToast("Modo presentacion cerrado.");
    }

    this.renderCurrentPage();
  }

  async toggleFullscreen() {
    const fullscreenTarget = typeof document.documentElement.requestFullscreen === "function"
      ? document.documentElement
      : document.body;

    if (typeof fullscreenTarget?.requestFullscreen !== "function") {
      this.showToast("Si tu navegador no cambia a pantalla completa, usa F11.");
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await fullscreenTarget.requestFullscreen();
      }
    } catch (error) {
      console.error(error);
      this.showToast("El navegador bloqueo la pantalla completa. Prueba con F11.");
    }

    this.updatePresentationUI();
  }

  async handleKeyDown(event) {
    const target = event.target;
    const tagName = target?.tagName;
    const isTypingTarget = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tagName)
      || target?.closest?.(".ql-editor");

    if (event.key === "Escape" && this.presentationMode && !document.fullscreenElement) {
      event.preventDefault();
      await this.togglePresentationMode(false);
      return;
    }

    if (!this.presentationMode || isTypingTarget) {
      return;
    }

    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      await this.navigateToPage(this.currentPageIndex + 1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      await this.navigateToPage(this.currentPageIndex - 1);
      return;
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      await this.toggleFullscreen();
    }
  }

  applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    this.elements.themeToggleLabel.textContent = theme === "light" ? "Modo oscuro" : "Modo claro";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "light" ? "#07111d" : "#05080f");
    }
  }

  readTheme() {
    return localStorage.getItem(THEME_KEY) || "dark";
  }

  showToast(message) {
    clearTimeout(this.toastTimer);
    this.elements.toast.textContent = message;
    this.elements.toast.classList.add("show");
    this.toastTimer = window.setTimeout(() => {
      this.elements.toast.classList.remove("show");
    }, TOAST_DURATION_MS);
  }

  countWords(text) {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  htmlToText(html) {
    const sandbox = document.createElement("div");
    sandbox.innerHTML = html;
    return sandbox.textContent || "";
  }

  formatDateTime(date) {
    return new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  dataUrlToFile(dataUrl, fileName, mimeType) {
    const [header, body] = dataUrl.split(",");
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const detectedMime = header.match(/data:(.*?);base64/)?.[1] || mimeType || "image/png";
    return new File([bytes], fileName, { type: detectedMime });
  }

  wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  normalizeHexColor(value, fallback = DEFAULT_TEXT_PAGE_COLOR) {
    const candidate = typeof value === "string" ? value.trim() : "";
    return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toUpperCase() : fallback;
  }

  hexToRgb(hex) {
    const normalized = this.normalizeHexColor(hex);
    return {
      red: Number.parseInt(normalized.slice(1, 3), 16),
      green: Number.parseInt(normalized.slice(3, 5), 16),
      blue: Number.parseInt(normalized.slice(5, 7), 16),
    };
  }

  rgbToHex(red, green, blue) {
    return `#${[red, green, blue]
      .map((value) => this.clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
      .join("")}`
      .toUpperCase();
  }

  hexToRgba(hex, alpha) {
    const { red, green, blue } = this.hexToRgb(hex);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  toPastelHex(hex) {
    const { red, green, blue } = this.hexToRgb(hex);
    return this.rgbToHex(
      red * 0.38 + 255 * 0.62,
      green * 0.38 + 255 * 0.62,
      blue * 0.38 + 255 * 0.62,
    );
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  getSpreadFallbackTitle(spread) {
    const index = this.state.spreads.findIndex((entry) => entry.id === spread.id);
    return `Bloque ${index + 1}`;
  }

  makeId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  escapeAttribute(value) {
    return this.escapeHtml(value).replaceAll("`", "&#96;");
  }
}

const app = new LibroVivoStudio();
void app.init();
