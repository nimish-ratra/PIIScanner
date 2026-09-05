# 🧠 Project Context & Developer/Agent Handbook: PIIScanner (PII Sentinel)

> **Purpose:** This file acts as the single source of truth for AI agents and human developers working on **PIIScanner (PII Sentinel)**. It details the complete architecture, technical decisions, feature sets, build processes, known gotchas, and testing methodologies.

---

## 1. Executive Summary & Core Philosophy

- **Application Name:** PII Sentinel (Repository: `PIIScanner`)
- **Target OS:** Windows 10 / Windows 11 (64-bit)
- **Primary Function:** A desktop application that recursively audits folders and documents for Personally Identifiable Information (PII), previews findings with secure redactions, extracts files while preserving directory trees, and packages files into password-protected encrypted archives.
- **Air-Gapped & Local-First:**
  - **Zero cloud calls:** All document extraction, OCR, and NLP entity detection happen entirely on the local machine.
  - **Zero telemetry:** No data, analytics, or file contents leave the host.
  - **Zero external APIs:** Microsoft Presidio and Apache Tika run locally on host CPU and JVM.

---

## 2. Technology Stack & Dependencies

| Layer | Technology | Role / Notes |
| :--- | :--- | :--- |
| **Language** | Python 3.10 - 3.14 (64-bit) | Tested and validated on Python 3.14 on Windows 11. |
| **GUI Framework** | `PySide6` (Qt 6 for Python) | Custom modern dark/light styling (`ui/theme.py`) with zero Tailwind/third-party UI wrappers. |
| **NLP Engine** | `presidio-analyzer` (Microsoft) | Rule-based and model-based PII identification. |
| **NLP Model** | `spaCy` (`en_core_web_sm`) | Lightweight spaCy pipeline for entity extraction (names, locations, etc.). |
| **Document Parser** | `tika` (Apache Tika) | Java-backed universal file format extraction (PDF, Office, etc.). |
| **JVM Backend** | JRE / JDK 8+ | Required by Apache Tika (`tika-server.jar`). Auto-locates standard Java installs. |
| **OCR (Optional)** | Tesseract OCR | Image-based text extraction for scanned documents (gracefully disabled if absent). |
| **Quarantine** | `pyzipper` | AES-256 encrypted zip archive creation with password protection. |
| **Packaging** | `pyinstaller` & `Inno Setup 6` | Bundles Python runtime and scripts into a standalone executable and `.exe` installer. |

---

## 3. Directory & Module Architecture

```
c:\PIISentinalApp\
├── backend/
│   ├── config.py             # User preferences & settings (%APPDATA%\PIISentinel\config.json)
│   ├── database.py           # SQLite persistence for scan runs (%APPDATA%\PIISentinel\history.db)
│   ├── file_ops.py           # Path-preserving file copy/move extraction and pyzipper encrypted zip
│   ├── logger.py             # Rotating file logger to %APPDATA%\PIISentinel\logs\sentinel.log
│   ├── presidio_detector.py  # Microsoft Presidio wrapper, dynamic entity query, masking previews
│   ├── reporter.py           # Auto-generates report.csv, report.json, and interactive report.html
│   ├── scanner.py            # Concurrent directory walker (ThreadPoolExecutor) with pause/cancel
│   └── tika_extractor.py     # Apache Tika parser, JVM environment auto-config, OCR fallback
├── ui/
│   ├── components/
│   │   ├── log_viewer.py     # Real-time console widget with color-coded log levels
│   │   └── stat_card.py      # Metric KPI card widget with gradient border & value styling
│   ├── views/
│   │   ├── history_view.py   # Historical scan audit trail, past findings reloader, delete action
│   │   ├── onboarding_dialog.py # Privacy guarantee & air-gapped confirmation modal
│   │   ├── results_view.py   # Sortable findings table, search, filtering, extraction/quarantine dialogs
│   │   ├── scan_view.py      # Target folder, dynamic entity chips, worker slider, progress, KPIs
│   │   └── settings_view.py  # Preferences, extensions list, max size, worker count, Java status
│   ├── main_window.py        # MainWindow coordinating sidebar navigation & stacked pages
│   ├── theme.py              # Pure QSS design system (Dark & Light tokens, buttons, inputs, tables)
│   └── workers/
│       └── scan_worker.py    # QThread worker bridge connecting backend Scanner to Qt UI signals
├── packaging/
│   ├── assets/               # app_icon.ico and app_icon.png
│   ├── build.py              # Automated 2-step build pipeline (PyInstaller -> Inno Setup ISCC)
│   ├── create_assets.py      # Programmatic generator for modern app icons
│   ├── installer.iss         # Inno Setup compilation script for single-file installer
│   └── pii_sentinel.spec     # PyInstaller spec configuring data bundles, hidden imports & icons
├── tests/
│   ├── create_test_samples.py # Generates clean & sensitive synthetic test files (.txt, .csv, .json, .docx)
│   ├── test_backend.py       # Comprehensive unit test suite for backend modules
│   ├── test_data/            # Synthetic sample documents for testing
│   └── test_ui.py            # Automated UI test suite with live scanner execution
├── dist/                     # Generated standalone executable folder (dist/PIISentinel/PIISentinel.exe)
├── dist_installer/           # Generated Windows setup installer (dist_installer/PIISentinel_Setup_v1.0.exe)
├── .gitignore                # Excludes build, dist, caches, logs, databases from git
├── CONTEXT.md                # Single source of truth handbook for agents & developers
├── LICENSE                   # MIT License
├── PRESIDIO_PII_CATALOG.md   # Complete Microsoft Presidio 23-entity specification & detection catalog
├── README.md                 # Public GitHub repository documentation
└── requirements.txt          # Python project dependencies
```

---

## 4. Key Subsystems Deep Dive

### 4.1. Text Extraction (`backend/tika_extractor.py`)
- **Apache Tika Automation:** Calls `tika.initVM()` and communicates via a local REST server.
- **Java Auto-Detection:** Automatically inspects:
  1. `PATH`
  2. `JAVA_HOME`
  3. `C:\Program Files\Eclipse Adoptium`
  4. `C:\Program Files\Java`
  5. `C:\Program Files (x86)\Java`
  6. `C:\Program Files\Microsoft`, `Amazon Corretto`, `BellSoft`
- **Silent Subprocess Execution & Flash Prevention:**
  - `_patch_tika_silent_process()`: Monkey-patches `tika.tika.Popen` so that internal Tika `cmd.exe` invocations run with `subprocess.CREATE_NO_WINDOW` (`0x08000000`) and `STARTUPINFO.wShowWindow = win32con.SW_HIDE` (`0`). This eliminates console window flashing when starting scans.
  - Silent status checks: `check_java_status()` and `check_tesseract_status()` always pass `_get_silent_creationflags()` to `subprocess.run`.
- **Thread-Safe Tika Pre-warming:**
  - Guarded by `_tika_lock = threading.Lock()`.
  - `ensure_tika_started()`: Pre-initializes the local Tika server synchronously once before multi-threaded file dispatch to eliminate worker race conditions.
- **Fast-Path Fallback:** Directly reads `.txt`, `.json`, `.xml`, `.csv` if Tika is unavailable or slow.
- **Size Safeguards:** Enforces `max_file_size_mb` (default 50 MB) before extraction.

### 4.2. PII Detection & Redaction (`backend/presidio_detector.py`)
- **Dedicated Reference Guide:** See [`PRESIDIO_PII_CATALOG.md`](file:///c:/PIISentinalApp/PRESIDIO_PII_CATALOG.md) for the complete 23-entity specification, regex patterns, checksums, and context word catalogs.
- **Singleton Pattern:** `PresidioDetector.get_instance()` prevents reloading heavy spaCy language models into memory multiple times.
- **Dynamic Entity Discovery:** Queries `analyzer.get_supported_entities()` at runtime (`EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `PERSON`, `IP_ADDRESS`, `US_SSN`, `IBAN_CODE`, `CRYPTO`, `DATE_TIME`, `LOCATION`, `URL`, etc. - 23 total entities).
- **Large Document Chunking:** Splits documents > 150,000 characters with 500-character overlap to avoid spaCy memory limits.
- **Redacted Previews:** `redact_value(val)` masks sensitive middle characters while retaining first and last characters for context (e.g. `alice@domain.com` -> `al********om`).

### 4.3. Multi-Worker Concurrent Scanning Engine (`backend/scanner.py`)
- **Concurrency Architecture:** Utilizes `concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers)`:
  - User can configure **1 to 8 workers** (default 2, recommended 2–4).
  - Yields 2.5× to 3× scan speedup across multi-core CPUs.
  - Calls `ensure_tika_started()` once before spawning worker threads so threads don't simultaneously spawn multiple JVM instances.
- **Thread Safety:** Uses `self._lock = threading.Lock()` to synchronize updates to `files_scanned`, `files_with_pii`, `findings`, `flagged_files`, `skipped_files`, and UI callback invocations (`on_progress`, `on_finding`, `on_log`).
- **Responsive Controls:**
  - `pause()`: Sets `_pause_event.clear()`. In-flight worker threads wait at `self._pause_event.wait()` checkpoints.
  - `resume()`: Sets `_pause_event.set()`.
  - `cancel()`: Sets `_stop_event`, clears pause gates, and invokes `self._executor.shutdown(wait=False, cancel_futures=True)`.

### 4.4. Extraction & Quarantine (`backend/file_ops.py`)
- **Relative Path Preservation:** When extracting flagged files to an output folder, the exact subfolder tree relative to the scan root is recreated.
- **Encrypted Quarantine Archive:** Files are packed into an AES-encrypted ZIP archive with a user-supplied password using `pyzipper.AESZipFile`. Original files can optionally be renamed to `.quarantined` or safely unlinked.

### 4.5. Reporting & History (`backend/reporter.py` & `backend/database.py`)
- Reports auto-generated in `%APPDATA%\PIISentinel\reports\<scan_id>\`:
  - `report.csv`
  - `report.json`
  - `report.html` (Interactive dashboard with KPI stat cards, risk breakdown, and sortable tables).
- SQLite history stored in `%APPDATA%\PIISentinel\history.db`.

### 4.6. Enterprise UI & Dual-Theme System (`ui/theme.py`, `ui/main_window.py`, `ui/views/scan_view.py`)
- **Responsive Non-Squishing Layout Architecture**:
  - `ScanView` encases all components in a root `QScrollArea(setWidgetResizable=True)`, preventing layout compression bugs on lower-resolution displays and Windows DPI scaling (125%/150%).
  - `StatCard` enforces guaranteed `min-height: 82px` and `min-width: 130px` dimensions so KPI titles and values never collapse into empty slots.
  - Dynamic entity checkboxes utilize a 2-column grid with generous spacing so entity labels are never truncated with ellipses.
- **Dual-Theme Architecture ("Obsidian Slate" Dark & "Studio Slate" Light)**:
  - Top header bar provides an instant 1-click theme switcher (`🌙 Dark Mode` / `☀️ Light Mode`).
  - Preference is dynamically persisted in `%APPDATA%\PIISentinel\config.json` and synchronized with `SettingsView`.
  - Color palettes adhere to high-contrast enterprise design standards (zinc/slate backgrounds, electric blue/emerald accents, crisp readable typography).
- **Qt Mnemonic Protection**:
  - Uses `&&` in `QGroupBox` titles and `QPushButton` labels (e.g. `Results && Action`, `Engine && Concurrency Settings`) to prevent Qt mnemonic accelerator keys from hiding ampersands.

---

## 5. Build Pipeline & Executable Creation

The build workflow is fully automated in [`packaging/build.py`](file:///c:/PIISentinalApp/packaging/build.py):

```powershell
python packaging/build.py
```

### Stage 1: PyInstaller Standalone (`dist/PIISentinel/PIISentinel.exe`)
- Governed by [`packaging/pii_sentinel.spec`](file:///c:/PIISentinalApp/packaging/pii_sentinel.spec).
- Bundles `spacy` models (`en_core_web_sm`), `presidio_analyzer`, `PySide6`, `pyzipper`, and icons.
- Configures necessary hidden imports: `thinc`, `blis`, `srsly`, `confection`, `cymem`, `murmurhash`.

### Stage 2: Inno Setup Windows Installer (`dist_installer/PIISentinel_Setup_v1.0.exe`)
- Governed by [`packaging/installer.iss`](file:///c:/PIISentinalApp/packaging/installer.iss).
- Auto-locates `ISCC.exe` in `C:\Program Files (x86)\Inno Setup 6\` or `%LOCALAPPDATA%\Programs\Inno Setup 6\`.
- Compiles into a single setup executable with Desktop shortcut, Start Menu entry, Java prerequisite checks, and uninstaller.

### ⚠️ Critical Windows Gotcha: Background Tika-Server Folder Lock
- **Problem:** When `PIISentinel.exe` or `python` is executed and uses Apache Tika, Tika spawns a background Java process:
  `cmd.exe /c "java -cp ...\tika-server.jar org.apache.tika.server.TikaServerCli ..."`
- This Java process inherits the current working directory (CWD) of the caller. If called from `dist\PIISentinel\`, Java keeps `C:\PIISentinalApp\dist\PIISentinel` locked even after `PIISentinel.exe` closes.
- When PyInstaller tries to clean/recreate `dist\PIISentinel`, it will fail with:
  `PermissionError: [WinError 32] The process cannot access the file because it is being used by another process: '...\dist\PIISentinel'`
- **Fix:** Before rebuilding with PyInstaller, always ensure any lingering background Tika Java processes are killed:
  ```powershell
  Get-Process java, cmd -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*tika-server*" } | Stop-Process -Force
  ```

---

## 6. How to Run & Verify

### Running from Source
```powershell
# 1. Activate environment
.venv\Scripts\Activate.ps1

# 2. Launch GUI
python main.py
```

### Running Automated Test Suites
```powershell
# Run backend tests (Config, Database, Redaction, Presidio, Tika, Scanner, Multi-worker)
python -m unittest tests/test_backend.py

# Run UI tests (MainWindow, Navigation, Results Table, Settings Persistence, Live UI Scan)
python -m unittest tests/test_ui.py
```

---

## 7. Rules for Future AI Agents

1. **Continuously Update `CONTEXT.md`:**
   - Whenever any changes (architectural, functional, UX fixes, or configuration) are made to the codebase, **always update `CONTEXT.md`** immediately to keep it 100% aligned with the latest state of the application.
2. **Maintain Thread Safety:**
   - Any modifications touching `backend/scanner.py` must maintain lock synchronization around shared state and callback emissions.
   - UI updates must always cross from background worker threads to Qt GUI via PySide6 `Signal.emit()`. Never touch QWidget properties directly from worker threads.
3. **Preserve Privacy Guarantees:**
   - Never introduce network calls, cloud dependencies, or telemetry logging.
   - Raw PII must never be written to plaintext temporary files or insecure logs; always use `redact_value` when displaying sensitive data in UI or summaries.
4. **Zero Console Window Flashing on Windows:**
   - Never spawn child processes (`subprocess.Popen` or `subprocess.run`) on Windows without specifying `creationflags=subprocess.CREATE_NO_WINDOW` and `startupinfo.wShowWindow = 0` (`SW_HIDE`). Console windows flashing during normal app usage degrade UX and trigger user alarm.
5. **Respect `.gitignore`:**
   - Never commit `dist/`, `build/`, `dist_installer/`, `__pycache__`, `*.db`, or `*.log` files to Git. Keep commits strictly clean.
6. **Always Rebuild After Modifying Core Engine for .exe Deliverables:**
   - When the user asks to see changes in the standalone `.exe`, run `python packaging/build.py` and verify both `dist/PIISentinel/PIISentinel.exe` and `dist_installer/PIISentinel_Setup_v1.0.exe` update.
