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
│   ├── classifier.py         # Microsoft Purview 5-tier sensitivity classification engine & rules
│   ├── config.py             # User preferences & settings (%APPDATA%\PIISentinel\config.json)
│   ├── custom_recognizers.py # Native Presidio recognizers for India PII (Verhoeff) & Secrets/Keys
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
│   │   ├── pii_selector_dialog.py # Dedicated lag-free modal dialogs (PiiSelector, PiiViewer, FileViewer)
│   │   └── stat_card.py      # Metric KPI card widget with gradient border & value styling
│   ├── views/
│   │   ├── history_view.py   # Historical scan audit trail, past findings reloader, delete action
│   │   ├── onboarding_dialog.py # Privacy guarantee & air-gapped confirmation modal
│   │   ├── results_view.py   # Sortable findings table, unmask toggle, row inspector, extraction/quarantine
│   │   ├── scan_view.py      # Target folder, lag-free PII configuration buttons, worker slider, KPIs
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

### 4.2. PII Detection & Redaction (`backend/presidio_detector.py` & `backend/custom_recognizers.py`)
- **Dedicated Reference Guide:** See [`PRESIDIO_PII_CATALOG.md`](file:///c:/PIISentinalApp/PRESIDIO_PII_CATALOG.md) for the complete 36-entity specification, regex patterns, checksums, and context word catalogs.
- **Singleton Pattern:** `PresidioDetector.get_instance()` prevents reloading heavy spaCy language models into memory multiple times.
- **Dynamic Entity Discovery (36 Entities):**
  - **Global PII:** `CREDIT_CARD`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `PERSON`, `LOCATION`, `ORGANIZATION`, `IP_ADDRESS`, `US_SSN`, `IBAN_CODE`, `CRYPTO`, `DATE_TIME`, `URL`, etc.
  - **India-Specific PII:** `IN_AADHAAR` (with Verhoeff checksum algorithm), `IN_PAN`, `IN_GSTIN`, `IN_IFSC`, `IN_PASSPORT`, `IN_VOTER_ID`.
  - **Developer Secrets & Credentials:** `AWS_ACCESS_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `SLACK_TOKEN`, `PRIVATE_KEY`, `JWT_TOKEN`.
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
  - `report.html` (Interactive dashboard with KPI stat cards, risk breakdown, sortable findings table, and client-side `👁️ Reveal Full Values` unmask toggle).
- **Full File Path Visibility**: Removed restrictive `max-width: 400px` and `text-overflow: ellipsis` in HTML report CSS so complete file locations wrap and remain 100% visible.
- **Database Schema (`findings` table)**: Stores both `value_redacted` (privacy preview) and `value_raw` (unmasked value) with automatic schema migration, allowing instant switching between masked and raw views on historical scans.

### 4.6. Enterprise UI & Lag-Free Modal Dialogs (`ui/components/pii_selector_dialog.py`, `ui/views/scan_view.py`, `ui/views/results_view.py`)
- **Lag-Free Modal PII Configuration**:
  - Replaced the nested 135px scroll area in `ScanView` with an active summary indicator and two dedicated buttons: `👁️ View Current PII Types` and `⚙️ Edit PII Detection Types...`.
  - `PiiSelectorDialog`: Spacious modal dialog with instant search filtering, category tabs (India PII, Developer Secrets, Financial, Personal, Gov IDs), one-click category toggles, and bulk select/deselect operations. Eliminates all nested scroll friction on the main window.
  - **PySide6 Signal Binding & State Sync Architecture**:
    - In PySide6, `QCheckBox.stateChanged` emits an integer `state` (`2` or `0`) whereas `Qt.Checked` is a `CheckState` enum that fails under Python identity check (`2 == Qt.Checked` evaluates to `False`). To ensure 100% state integrity, entity checkboxes bind to `cb.toggled.connect(lambda checked, e=ent: ...)` which receives clean Python `bool` values, and category checkboxes bind to `cat_cb.clicked.connect(...)` which fires strictly on direct user interaction and never on programmatic state changes.
    - Customized subsets (e.g. India PII only, or custom secret detectors) persist dynamically to `config_manager.selected_entities` and retain their exact subset across dialog openings without resetting to all 36.
    - Includes empty selection validation warning (`_on_save_clicked`) to ensure at least 1 entity type remains active before applying.
  - `PiiViewerDialog`: Read-only modal displaying all currently active entities categorized with descriptions.
  - `FileViewerDialog`: Document explorer dialog listing all discovered files in the selected folder with instant search filtering.
- **Unmasked Raw Values Toggle**:
  - `ResultsView` features a prominent `👁️ Reveal Full Values` / `🔒 Mask Sensitive Values` toggle button.
  - Switches table findings between redacted previews (`sn*********in`) and unmasked raw values (`sneha.sharma@corp.in`) with coral warning tints and full tooltips.
  - Double-clicking any row opens `FindingDetailsDialog` displaying unclipped file paths, raw and redacted values, and file metadata with copy buttons.
  - Split filter controls into a 2-row toolbar (Row 1: Search, Entity Filter, Min Conf, Reveal Toggle; Row 2: CSV Export, Extract Flagged Files, Quarantine) eliminating button squeezing and text clipping.
- **Responsive Non-Squishing Layout Architecture**:
  - `ScanView` encases all components in a root `QScrollArea(setWidgetResizable=True)`, preventing layout compression bugs on lower-resolution displays and Windows DPI scaling (125%/150%).
  - `StatCard` enforces guaranteed `min-height: 82px` and `min-width: 130px` dimensions so KPI titles and values never collapse into empty slots.
- **Dual-Theme Architecture ("Obsidian Slate" Dark & "Studio Slate" Light)**:
  - Top header bar provides an instant 1-click theme switcher (`🌙 Dark Mode` / `☀️ Light Mode`).
  - Preference is dynamically persisted in `%APPDATA%\PIISentinel\config.json` and synchronized with `SettingsView`.
- **Qt Mnemonic Protection**:
  - Uses `&&` in `QGroupBox` titles and `QPushButton` labels (e.g. `Results && Action`, `Engine && Concurrency Settings`) to prevent Qt mnemonic accelerator keys from hiding ampersands.

### 4.7. Microsoft Purview 5-Tier Sensitivity Classification Engine (`backend/classifier.py`)
PII Sentinel aligns with **Microsoft Purview Information Protection (MIP)** industry standards to automatically assign one of five sensitivity labels to individual findings and entire documents:

| Tier Level | Microsoft Sensitivity Label | Color & Visual Badge | Criteria & Detection Mappings |
| :---: | :--- | :--- | :--- |
| **Level 5** | **Restricted** | `🟣 Restricted` (`#a855f7`) | Developer secrets, credentials, and API keys (`AWS_ACCESS_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `SLACK_TOKEN`, `PRIVATE_KEY`, `JWT_TOKEN`), OR extreme bulk exposure ($\ge 50$ PII records). |
| **Level 4** | **Highly Confidential** | `🔴 Highly Confidential` (`#ef4444`) | National Government Identifiers (`IN_AADHAAR`, `IN_PAN`, `IN_GSTIN`, `IN_IFSC`, `IN_PASSPORT`, `IN_VOTER_ID`, `US_SSN`, `US_PASSPORT`, `UK_NHS`), Financial & Cardholder Data (`CREDIT_CARD`, `IBAN_CODE`, `CRYPTO`, `US_BANK_NUMBER`), OR bulk records ($\ge 10$ items). |
| **Level 3** | **Confidential** | `🟠 Confidential` (`#f59e0b`) | Personal contact & identification records (`EMAIL_ADDRESS`, `PHONE_NUMBER`, `PERSON`, `LOCATION`, `DATE_TIME`, `AGE`, `IP_ADDRESS`, `URL`, `NRP`) with 1–9 instances. |
| **Level 2** | **General** | `⚪ General` (`#94a3b8`) | Internal business documents with 0 sensitive PII items discovered. |
| **Level 1** | **Public** | `🟢 Public` (`#22c55e`) | Unrestricted public documents with 0 sensitive PII items discovered. |

- **Multi-Level Aggregation & Volume Escalation**:
  - `classify_finding(finding)`: Maps each detected PII token to its designated Purview risk tier.
  - `classify_document(findings)`: Evaluates all findings within a single file. Implements volume-based risk escalation: documents with $\ge 10$ contact records escalate from `Confidential` to `Highly Confidential`; documents with $\ge 50$ records escalate to `Restricted`.
- **Database & Report Persistence**:
  - Automatically migrates SQLite `findings` table in `%APPDATA%\PIISentinel\history.db` to include `classification TEXT`.
  - Exports `classification` in `report.csv` and `report.json`.
  - In `report.html`: Renders 5 Purview KPI breakdown cards, color-coded badges, and dual-filter JavaScript controls.
- **Desktop UI Integration**:
  - Findings table in `ResultsView` expanded to 7 columns with dedicated `Sensitivity` column displaying color-coded badges and hover tooltips explaining the exact classification rationale.
  - Added `combo_classification` dropdown filter to toolbar (`All Classifications`, `🟣 Restricted`, `🔴 Highly Confidential`, `🟠 Confidential`, `⚪ General`, `🟢 Public`).
  - Double-clicking any row opens `FindingDetailsDialog` displaying sensitivity tier badges and rationale rules.
  - Scan summary card in `ScanView` highlights the highest sensitivity tier discovered upon scan completion.

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
