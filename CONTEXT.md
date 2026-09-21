# 🧠 Project Context & Developer/Agent Handbook: PIIScanner (ClAIssify, formerly "PII Sentinel")

> **Purpose:** This file acts as the single source of truth for AI agents and human developers working on **PIIScanner**, user-facing product name **ClAIssify** (rebranded cosmetically from "PII Sentinel" - see §12.13; internal paths, registry keys, and identifiers still reference the old name by design). It details the complete architecture, technical decisions, feature sets, build processes, known gotchas, and testing methodologies.

---

## 1. Executive Summary & Core Philosophy

- **Application Name:** PII Sentinel (Repository: `PIIScanner`)
- **Target OS:** Windows 10 / Windows 11 (64-bit)
- **Primary Function:** A desktop application that recursively audits folders and documents for Personally Identifiable Information (PII), previews findings with secure redactions, extracts files while preserving directory trees, and packages files into password-protected encrypted archives.
- **Air-Gapped & Local-First:**
  - **Zero cloud calls:** All document extraction, OCR, and NLP entity detection happen entirely on the local machine.
  - **Zero telemetry:** No data, analytics, or file contents leave the host.
  - **Zero external APIs:** Microsoft Presidio and Apache Tika run locally on host CPU and JVM.
  - **One deliberate exception (Phase 4 — see §10):** Licensing/activation calls out to the TrustFabric backend over HTTPS. No scanned content, findings, or PII of any kind is ever included in that traffic — only an enrollment token, a hashed device fingerprint, and a self-declared name/email for accountability. Standalone evaluation mode is preserved without requiring internet access.
  - **100% Local File & DLP Processing:** All file inspection, OCR, Presidio entity detection, Office save interception, and format-aware watermarking happen strictly on the local machine with zero external cloud transmission.

---

## 2. Technology Stack & Dependencies

| Layer | Technology | Role / Notes |
| :--- | :--- | :--- |
| **Language** | Python 3.10 - 3.14 (64-bit) | Tested and validated on Python 3.14 on Windows 11. |
| **GUI Framework** | `PySide6` (Qt 6 for Python) | Custom QSS styling (`ui/theme.py`), one fixed theme (no Dark/Light toggle, see §12), zero Tailwind/third-party UI wrappers. |
| **NLP Engine** | `presidio-analyzer` (Microsoft) | Rule-based and model-based PII identification. |
| **NLP Model** | `spaCy` (`en_core_web_sm`) | Lightweight spaCy pipeline for entity extraction (names, locations, etc.). |
| **Document Parser** | `tika` (Apache Tika) | Java-backed universal file format extraction (PDF, Office, etc.). |
| **JVM Backend** | JRE / JDK 8+ | Required by Apache Tika (`tika-server.jar`). Auto-locates standard Java installs. |
| **OCR (Optional)** | Tesseract OCR | Image-based text extraction for scanned documents (gracefully disabled if absent). |
| **Quarantine** | `pyzipper` | AES-256 encrypted zip archive creation with password protection. |
| **Packaging** | `pyinstaller` & `Inno Setup 6` | Bundles Python runtime and scripts into a standalone executable and `.exe` installer. |
| **Licensing** | `requests`, `pywin32` (`win32crypt`) | HTTPS client to the TrustFabric licensing backend; Windows DPAPI for encrypting the stored installation credential at rest. See §10. |

---

## 3. Directory & Module Architecture

```
c:\PIISentinalApp\
├── backend/
│   ├── classifier.py         # Microsoft Purview 5-tier sensitivity classification engine & rules
│   ├── config.py             # User preferences & settings (%APPDATA%\PIISentinel\config.json)
│   ├── custom_recognizers.py # Native Presidio recognizers for India PII (Verhoeff) & Secrets/Keys
│   ├── database.py           # SQLite persistence for scan runs (%APPDATA%\PIISentinel\history.db)
│   ├── drive_scanner.py      # Fixed physical drive enumeration, noise directory exclusion filters
│   ├── file_ops.py           # Path-preserving file copy/move extraction and pyzipper encrypted zip
│   ├── license_client.py     # TrustFabric licensing client — register/heartbeat/policy/release (Phase 4, see §10)
│   ├── logger.py             # Rotating file logger to %APPDATA%\PIISentinel\logs\sentinel.log
│   ├── presidio_detector.py  # Microsoft Presidio wrapper, dynamic entity query, masking previews
│   ├── reporter.py           # Auto-generates report.csv, report.json, and interactive report.html
│   ├── scanner.py            # Concurrent directory & drive walker (ThreadPoolExecutor) with pause/cancel
│   ├── tika_extractor.py     # Apache Tika parser, JVM environment auto-config, OCR fallback
│   ├── watermark_backup.py   # Byte-for-byte pre-mutation backup, rollback/restore, retention pruner
│   └── watermark_engine.py   # Format-aware visual & NTFS ADS watermarking, idempotency engine
├── service/
│   ├── api_server.py         # FastAPI local microservice on loopback 127.0.0.1:47821
│   ├── enforcement_policy.py # Dynamic tier action mapper (Office block vs Watcher quarantine)
│   ├── service_controller.py # Windows process controller (start/stop/health checks)
│   └── service_runner.py     # Windows background runner with system tray icon & autostart
├── ui/
│   ├── components/
│   │   ├── card.py           # Card/CardHeader/CardTitle/CardDescription-style container (Phase 6, see §12)
│   │   ├── icon_label.py     # Icon + text compound label
│   │   ├── log_viewer.py     # Real-time console widget with color-coded log levels
│   │   ├── metric_column.py  # KPI metric column display
│   │   ├── pii_selector_dialog.py # Dedicated lag-free modal dialogs (PiiSelector, PiiViewer, FileViewer)
│   │   ├── stat_card.py      # Metric KPI card widget with gradient border & value styling
│   │   └── status_badge.py   # Semantic status badges
│   ├── views/
│   │   ├── activation_dialog.py # Enrollment token + name + email form; redeems against TrustFabric (Phase 4, see §10)
│   │   ├── history_view.py   # Historical scan audit trail, past findings reloader, delete action
│   │   ├── license_gate_window.py # "License required / pending approval / standalone mode" window (Phase 4, see §10)
│   │   ├── live_monitoring_view.py # Real-time file system & clipboard DLP monitoring
│   │   ├── onboarding_dialog.py # Privacy guarantee & air-gapped confirmation modal
│   │   ├── results_view.py   # Sortable findings table, unmask toggle, row inspector, extraction/quarantine
│   │   ├── scan_view.py      # Target folder, lag-free PII configuration buttons, worker slider, KPIs
│   │   ├── settings_view.py  # Preferences, extensions list, max size, worker count, Java status
│   │   └── watermark_review_dialog.py # Batch watermark review, selection, and undo dialog
│   ├── main_window.py        # MainWindow coordinating 5-tab sidebar navigation (Scan, Results, History, Live, Settings)
│   ├── icons.py              # Bundled Lucide SVG icons (packaging/assets/icons/) renderer at runtime (Phase 6, see §12)
│   ├── theme.py              # Single fixed QSS design system (buttons, inputs, tables, cards, sidebar)
│   └── workers/
│       └── scan_worker.py    # QThread worker bridge connecting backend Scanner to Qt UI signals
├── packaging/
│   ├── assets/               # app_icon.ico, claissify_icon.png, and Lucide SVG icons
│   ├── build.py              # Automated 2-step build pipeline (PyInstaller -> Inno Setup ISCC)
│   ├── create_assets.py      # Programmatic generator for modern app icons
│   ├── installer.iss         # Inno Setup compilation script for single-file installer
│   └── pii_sentinel.spec     # PyInstaller spec configuring data bundles, hidden imports & icons
├── tests/
│   ├── create_test_samples.py # Generates clean & sensitive synthetic test files (.txt, .csv, .json, .docx)
│   ├── test_backend.py       # Comprehensive unit test suite for backend modules
│   ├── test_data/            # Synthetic sample documents for testing
│   ├── test_license_client.py # 29-test suite for the TrustFabric licensing client (Phase 4, see §10)
│   ├── test_ui.py            # Automated UI test suite with live scanner execution
│   └── verify_activation_manual.py # Standalone script showing only ActivationDialog for manual testing
├── test_data/
│   └── india_pii_sample.txt  # Synthetic Indian-context PII test fixture (valid Aadhaar/PAN/GSTIN/IFSC patterns + fake dev secrets)
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

# Run the licensing client suite (Phase 4, see §10) — only needs PySide6,
# requests, and pywin32, not the full Presidio/spaCy/Tika stack
cd agent
python -m unittest tests.test_license_client -v
```

### Manually Verifying the Licensing Connection
`tests/verify_activation_manual.py` shows only `ActivationDialog` against the real `backend/license_client.py` — no `MainWindow`, no scanning engine — for quickly proving a live enrollment token round-trips correctly against an actual TrustFabric backend:
```powershell
cd agent
python tests/verify_activation_manual.py
```
It prints the resolved backend URL, whether a credential is already registered, the outcome of the dialog, and then attempts a live heartbeat, printing the server's returned policy.

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
7. **Zero Emoji / Non-ASCII in Windows Console Output (`cp1252`):**
   - Standard Windows Command Prompt (`cmd.exe`) uses the `cp1252` code page by default. Never output emoji characters (e.g. `✅`, `🛡️`, `🟢`, `•`) via `print()` from CLI tools or background runners, as Python will raise `UnicodeEncodeError: 'charmap' codec can't encode character...`. Always use standard ASCII tags (e.g. `[OK]`, `[PII Sentinel]`, `[ERROR]`).
8. **Preserve User Configuration During Automated Testing:**
   - Any test suite that modifies `policy_manager` or `config_manager` must back up the original user settings in `setUpClass` and restore them in `tearDownClass`. Never leave `%APPDATA%\PIISentinel\` configured with temporary test paths that break the user's active session upon test completion.
9. **Preserve Licensing Security Invariants (Phase 4, see §10):**
   - Never relax `backend/license_client.py`'s HTTPS-only enforcement (`_validate_backend_url`) — the `localhost`/`127.0.0.1` carve-out exists strictly for local development, never for a real deployment.
   - Never persist the installation credential (or any other secret) to `license.json` in plaintext — it must always go through `win32crypt.CryptProtectData`/`CryptUnprotectData` (DPAPI), scoped to the current Windows user.
   - Never build `Authorization` headers by re-prepending `installationId` to `state['credential']` — that field is already the full `"<installationId>.<secret>"` string returned by `POST /agent/register`; doing so once already produced a real bug (a malformed bearer token indistinguishable from a genuine revocation) — see `test_35_authorized_headers_do_not_double_prefix_installation_id` in `tests/test_license_client.py`.
   - Never let `agent/main.py` or `service/service_runner.py`'s `--service` entry point construct `MainWindow` / start the background service before checking `license_client.enforcement_status()` — a `PENDING`/`SUSPENDED`/`REVOKED`/grace-expired installation must never reach the scanning engine.
10. **100% On-Device Local Endpoint Security Model:**
    - The desktop application operates strictly on-device. All file discovery, text extraction, Presidio PII analysis, sensitivity classification, quarantine, and format-aware watermarking occur locally on the user's workstation.
    - Zero data, metadata, or telemetry is ever transmitted to external cloud services or vendors.
    - Standalone evaluation mode is preserved: while enterprise TrustFabric licensing check-in is supported via `backend/license_client.py`, unconfigured or offline standalone local execution remains fully functional.
11. **Keep `ui/theme.py` the Single Source of Truth for Chrome Styling (Phase 6, see §12):**
    - Structural styling (backgrounds, borders, radii, button/input/table appearance) belongs in `ui/theme.py`'s QSS, addressed by the existing object names (`#primaryButton`, `#sidebar`, `.card`/`QGroupBox`, etc.) — not as a new inline `setStyleSheet(...)` call scattered in a view file. Several older views (`results_view.py`, `settings_view.py`) still have such inline styles predating this rule; don't add more, and prefer migrating one to a theme selector over duplicating its hex values elsewhere.
    - The one legitimate exception is genuinely semantic/functional color — the offline badge, sensitivity-tier badges (`backend/classifier.py`'s `TIER_METADATA`), success/danger/warning buttons. Those must keep their meaning-carrying color; everything else should read from `ui/theme.py`'s tokens (including its one deliberate accent color, blue, used the same way the TrustFabric customer-portal uses it — see §12) rather than introducing new ad-hoc colors per view. There is a single fixed theme — do not reintroduce a Dark/Light toggle without being asked.
12. **Document Only Implemented Components & Code:**
    - A tech-stack table entry, architectural component, or section cross-reference must only be written once the corresponding code and section actually exist. Planned-but-unbuilt work belongs in a separate "Not Yet Built" roadmap note or an issue tracker, and must never be presented in the stack table or main documentation as if it has already shipped.

---

## 8. Phase 2: Real-Time Save Enforcement Layer

### 8.1 Architecture & Two-Tier Enforcement Model

Phase 2 adds proactive real-time protection alongside Phase 1's batch directory scanning, using a **shared local microservice** to evaluate content against Microsoft Purview's 5 sensitivity tiers.

```
                    ┌────────────────────────────────────────────────────────┐
                    │               AIR-GAPPED CLIENT MACHINE                │
                    │                                                        │
                    │  ┌───────────────────────┐  ┌───────────────────────┐  │
                    │  │ Microsoft Word/Excel  │  │ Generic File Watcher  │  │
                    │  │ (VSTO/COM Add-In)     │  │ (Desktop, Docs, Dls)  │  │
                    │  └──────────┬────────────┘  └───────────┬───────────┘  │
                    │             │ In-Memory Text            │ Post-Write   │
                    │             │ (Pre-Save)                │ File Path    │
                    │             ▼                           ▼              │
                    │  ┌───────────────────────────────────────────────────┐  │
                    │  │  Shared Local Classification Service              │  │
                    │  │  http://127.0.0.1:47821 (FastAPI Loopback-Only)   │  │
                    │  ├───────────────────────────────────────────────────┤  │
                    │  │  • Presidio Detector (Indian PII & Secrets)       │  │
                    │  │  • Microsoft Purview 5-Tier Classifier            │  │
                    │  │  • Enforcement Policy Manager                     │  │
                    │  └──────────────────┬────────────────────────────────┘  │
                    │                     │ Action: block / quarantine /      │
                    │                     │         warn / allow              │
                    │                     ▼                                   │
                    │  ┌───────────────────────────────────────────────────┐  │
                    │  │  Enforcement Outcomes:                            │  │
                    │  │  • Office: Pre-Save Block (Cancel=true) + WPF UI  │  │
                    │  │  • Watcher: AES-256 Zip Quarantine + Win Toast    │  │
                    │  │  • Audit: SQLite enforcement_events in history.db │  │
                    │  └───────────────────────────────────────────────────┘  │
                    └────────────────────────────────────────────────────────┘
```

1. **Tier 1 — Office Pre-Save Block (Word & Excel):**
   - Implemented as a C# COM/VSTO Add-In (`office_addin/`).
   - Hooks native `Application.DocumentBeforeSave` and `Application.WorkbookBeforeSave`.
   - Extracts text directly from the in-memory document model via Office Interop prior to writing to disk.
   - If the local classification service recommends `block`, the event handler sets `Cancel = true`, preventing file writing.
   - Displays a modal WPF dialog (`BlockDialog.xaml`) showing sensitivity tier, redacted findings, and an override escape hatch requiring an audit rationale (`TxtOverrideReason`, minimum 5 characters with live validation).
   - Clicking *"Save Anyway (Override)"* validates the rationale, sets `dialog.UserOverridden = true`, closes the modal, and causes the event handler to explicitly set `Cancel = false` so Word/Excel saves the file cleanly. Concurrently logs an audit event (`POST /enforcement/log`) with `action_taken="override"`, `user_override=true`, and the typed justification.
2. **Tier 2 — Generic Filesystem Watcher (Detect-and-Remediate):**
   - Implemented with `watchdog` (`file_watcher/watcher_service.py`).
   - Monitors user directories: Desktop, Documents, Downloads.
   - Debounces rapid consecutive write events (2.0s debounce window) and waits for file handle write locks to release.
   - Calls `POST /classify/file` on the local microservice.
   - If the policy recommends `quarantine`, moves the file into an AES-256 encrypted zip (`file_watcher/quarantine_bridge.py`), permanently deletes the plaintext file, and displays a Windows toast notification (`file_watcher/toast_notifier.py`).
   - *Architectural Boundary:* Filesystem watcher is strictly detect-and-remediate; override affordances apply solely to Office pre-save interception.
   - **Theoretical Phase 3 Escalation:** A signed Windows Kernel Minifilter Driver (`fltmgr.sys`) would be required for pre-write blocking of generic non-Office applications (e.g. Notepad, VS Code). In Phase 2, the post-write detect-and-remediate model provides immediate coverage without kernel driver signing hurdles.

### 8.2 Shared Local Classification Microservice (`service/`)

- **Location:** `service/api_server.py`
- **Host & Port:** `127.0.0.1:47821` (never binds to `0.0.0.0`).
- **Two-Tier Security Gate (`verify_loopback_and_auth`):**
  - **Tier 1 (Loopback Enforcement):** Rejects any request originating from non-loopback IP addresses (`127.0.0.1`, `::1`, `localhost`) with `403 Forbidden`.
  - **Tier 2 (Shared-Secret Bearer Token Authentication):** Enforces that every request across all endpoints (including `/health` and `/service/stop`) supplies the custom header `X-PIISentinel-Token`.
  - **Token Generation & Storage (`backend/service_auth.py`):** On first run, a cryptographically secure token (`secrets.token_urlsafe(32)`) is generated and persisted to `%APPDATA%\PIISentinel\service_token` with current-user-only NTFS permissions.
  - **Constant-Time Verification:** Headers are verified using `hmac.compare_digest` to prevent timing attacks. Rejections return identical 403 Forbidden responses to avoid leaking whether IP or token validation failed.
  - **Protection Scope:** Completely neutralizes cross-origin browser JavaScript attacks (e.g. malicious webpages executing unprompted `fetch('http://127.0.0.1:47821/service/stop', {method: 'POST'})` to disable endpoint defenses).
  - **Trusted Callers:** `ServiceController`, `ApiClient.cs`, `SettingsView`, and `LiveMonitoringView` automatically load the shared secret from `%APPDATA%\PIISentinel\service_token` and supply `X-PIISentinel-Token`.
  - **Deployment & Backward-Compatibility Note:** The Office add-in (`office_addin/ApiClient.cs`) and Python microservice must be built and deployed in coordination. An older add-in binary lacking token injection will receive 403 Forbidden responses from a hardened microservice; run `office_addin/build_and_register.ps1` whenever the microservice auth layer is updated.
- **Endpoints:**
  - `GET /health` — liveness probe returning service health, timestamp, and active fail-safe mode (requires `X-PIISentinel-Token`).
  - `POST /classify/text` — body: `{"text": string, "source_hint": string}` -> returns `{tier, level, badge, findings, recommended_action, rationale}`.
  - `POST /classify/file` — body: `{"path": string}` -> runs Apache Tika extraction followed by Presidio + Purview classification.
  - `POST /enforcement/log` — logs block, quarantine, warn, allow, or override events to SQLite.
  - `GET /policy` and `POST /policy` — read/update active policy mapping and real-time selected entity list (`realtime_selected_entities`).
  - `GET /policy/realtime-entities` and `POST /policy/realtime-entities` — dedicated loopback endpoints for querying and updating the active real-time entity subset without service restart.
- **Scoped Entity Filtering:** `POST /classify/text` and `POST /classify/file` filter Presidio findings to `config_manager.realtime_selected_entities` before document classification. This ensures real-time pre-save blocks and file watcher quarantines are independently configurable from batch directory scans (`config_manager.selected_entities`).
- **UI Configuration:** Real-time detection types are managed via `PiiSelectorDialog(mode="realtime")` in Settings (Tab 2: *Real-Time Detection Types*) and surfaced as a dedicated KPI card with an inline `⚙️ Edit` shortcut in *Live Monitoring*.
- **Standalone CLI Invocation:** `python -m service.api_server` directly starts the Uvicorn web service.
- **Service Runner:** `service/service_runner.py` runs the background service with a system tray icon (`pystray`), pause/resume toggle, and Windows autostart helper (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`). Menu items include *"Open Logs Folder"* and *"View Enforcement Log"* wired directly to `%APPDATA%\PIISentinel\logs\` via `get_logs_dir()`. Output uses standard ASCII strings to ensure 100% compatibility with Windows `cp1252` console encoding.
- **Audit Logging:** Writes rotating audit logs to `%APPDATA%\PIISentinel\logs\enforcement.log`. Raw PII is never logged; only redacted summaries are persisted.

### 8.3 Enforcement Policy Mapping (`service/enforcement_policy.py`)

- **Monitored Folders Configuration & Hot Reload:** `watched_folders` persists the user-defined list of directories monitored for file saves. Defaults (`Desktop`, `Documents`, `Downloads`) are initialized on first launch without reverting user removals. When folders are modified in Settings, `SettingsView._push_policy_live()` pushes the updated list to `POST /policy`, which hot-reloads the Watchdog observer (`ServiceRunner.reload_watcher()`). Additionally, `WatcherHandler` enforces strict path containment checks (`_is_in_watched_folders`), immediately dropping filesystem events from removed or unmonitored directories before debounce or inspection.
- **Default Tier Actions:**
  - 🟣 `Restricted` -> `block`
  - 🔴 `Highly Confidential` -> `block`
  - 🟠 `Confidential` -> `warn`
  - ⚪ `General` -> `allow`
  - 🟢 `Public` -> `allow`
- **Dual-Path Resolution (`get_action_for_tier` / `resolve_action`):**
  - In Office documents: `quarantine` maps to `block` (pre-save block).
  - In Generic files: `block` maps to `quarantine` (post-write remediation).
- **Quarantine Password Hardening (Windows DPAPI):** `quarantine_password` is never stored in plaintext on disk. The setter in `EnforcementPolicyManager` transparently encrypts the password with Windows DPAPI (`win32crypt.CryptProtectData`), tying decryption strictly to the current Windows user account (`dpapi:<base64>`). The getter transparently decrypts (`CryptUnprotectData`) for file archive operations in `file_watcher/quarantine_bridge.py`.
- **Secret Redaction on Read:** `GET /policy` and `POST /policy` responses mask `quarantine_password` (and any fields in `SECRET_POLICY_FIELDS`) to `"********"` before returning JSON to callers, preventing accidental credential harvesting.
- **Strict Schema Validation (`PolicyUpdateRequest`):** `POST /policy` is validated via Pydantic v2 with `model_config = ConfigDict(extra="forbid")`. Unknown or malicious keys are rejected with `HTTP 422 Unprocessable Entity` rather than silently accepted. Configurable fields include `realtime_selected_entities`, `tier_actions`, `fail_open`, `fail_safe_mode`, `watched_folders`, `quarantine_archive_path`, `quarantine_password`, `enforce_office`, `enforce_watcher`, `toast_notifications`, and `api_port`. The internal `api_host` remains strictly locked to `127.0.0.1`.
- **Fail-Safe Mode & Offline Resolution:**
  - `Fail-Closed` (Default / High Security): Blocks or quarantines if the microservice is unreachable, preventing accidental data leaks.
  - `Fail-Open` (Permissive): Allows document saves without interruption if the microservice is stopped.
  - **Dynamic Client Fallback (`ApiClient.cs`):** If the microservice is stopped or unreachable during an Office save event, `ApiClient.cs` reads `%APPDATA%\PIISentinel\enforcement_policy.json` directly from disk. If `enforce_office` is disabled or `fail_safe_mode` is configured to `fail-open`, saves are immediately permitted (`allow` with `⚪ General (Service Offline)`). If configured to `fail-closed`, saves are safely blocked (`🔴 Fail-Closed Protection`) with an informative offline warning.

### 8.4 Office Add-In Compilation & Per-User Registration

- **Language & Framework:** C# (.NET Framework 4.5/4.8).
- **Project & Solution:** `office_addin/PIISentinelAddin.csproj` and `PIISentinelAddin.sln`.
- **Build Command:**
  ```powershell
  & "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe" office_addin\PIISentinelAddin.csproj /p:Configuration=Release
  ```
- **Non-Admin COM Registration (`office_addin/build_and_register.ps1`):**
  - Generates COM registration script via `RegAsm.exe office_addin\bin\Release\PIISentinel.OfficeAddin.dll /regfile:office_addin\com_reg.reg`.
  - Replaces `HKEY_CLASSES_ROOT` with `HKEY_CURRENT_USER\Software\Classes` and imports via `reg.exe import`.
  - Registers Office COM Add-In keys in:
    - `HKCU\Software\Microsoft\Office\Word\Addins\PIISentinel.OfficeAddin`
    - `HKCU\Software\Microsoft\Office\Excel\Addins\PIISentinel.OfficeAddin`
    - `LoadBehavior = 3` (Load at startup).
  - Works 100% without Administrator elevation.

### 8.5 UI Extensions & Audit Logging

- **Database Extension (`backend/database.py`):**
  - Created and migrated `enforcement_events` table: `id`, `timestamp`, `file_path`, `tier`, `action_taken`, `user_override`, `override_reason`, `entity_summary`, `source`, `detection_types`, `app_source`.
  - Indexed by `timestamp DESC`, `tier`, `action_taken`, and `app_source`.
  - Built-in CSV exporter `export_enforcement_events_csv` guaranteeing safe redacted data.
- **Dedicated Real-Time Interception Log View (`ui/views/history_view.py` Tab 2):**
  - Search & Multi-Filter Bar: Free-text search over file paths, filtering by Action (BLOCK, QUARANTINE, WARN, OVERRIDE, ALLOW), Sensitivity Tier, and Source (Word, Excel, Filesystem Watcher).
  - 7-Column Redesigned Grid: Timestamp, File / Document (with full path tooltip), Source (with icon badge), Sensitivity Tier (Purview color badge), Detected Types (truncated list with tooltip), Action Taken (distinct colored pills), and Override Info.
  - Detail Inspector: Double-click or `👁️ Inspect Event Details...` opens `EnforcementEventDetailsDialog` (`ui/components/enforcement_details_dialog.py`) showing complete file location, source, action, override rationale, and redacted findings (raw PII is strictly never rendered).
  - One-Click CSV Export: `📥 Export Audit CSV` writes complete historical or filtered enforcement logs to disk.
- **Live Monitoring View (`ui/views/live_monitoring_view.py`):**
  - Dedicated real-time monitoring view embedded as Nav Tab 4 in `MainWindow`.
  - 1-Click GUI controls to Start, Stop, and Probe the background protection service.
  - 5 Real-Time KPI Cards: Office Pre-Save Guard status, Filesystem Watcher monitored folders count, Enforcement Policy mode (Fail-Closed/Fail-Open), Real-Time Detection Types count (with inline `⚙️ Edit` shortcut), and Total Interceptions recorded.
  - **Zero-Lag Asynchronous Polling (`LiveStatusWorker`):** Background socket probes and SQLite event queries run off the main GUI thread via `LiveStatusWorker(QThread)`. Main thread receives updates strictly via Qt signals with 0ms event loop blocking.
  - **Smart Diff-Based Table Rendering:** Interception table updates track signature diffs and utilize `table.setUpdatesEnabled(False/True)` batching, completely eliminating redundant UI item teardowns and rebuilds.
  - **Adaptive Polling Throttling:** Polling intervals dynamically scale from 2.5s (when actively viewing Live Monitoring) to 6.0s (when working on Scan, Results, or Settings), automatically bypassing database queries when hidden.
  - Interactive test probe button sending mock pre-save classification payloads with millisecond response latency timing.
- **Service Controller & Graceful Shutdown (`service/service_controller.py` & `service/api_server.py`):**
  - Central programmatic lifecycle manager (`is_running`, `start`, `stop`, `is_port_bound`, `is_port_listening`, `get_health`, `test_pre_save_probe`).
  - **Fast Non-Blocking Socket Pre-Check (`is_port_listening`):** Uses a 30ms non-blocking socket connect probe prior to invoking HTTP `get_health`, reducing offline detection latency from 1,030ms to < 35ms (a 96.5% reduction).
  - Implements fully idempotent `start()` and `stop()` operations with clean port verification.
  - Added `POST /service/stop` endpoint to FastAPI microservice for clean remote teardown of both the Uvicorn server and the Watchdog observer thread.
  - Top Utility Bar in `MainWindow` features a live Service Status indicator pill (`🟢 SERVICE: ACTIVE` / `🔴 SERVICE: OFFLINE`) and quick 1-click `▶ Start Service` / `⏹ Stop Service` toggle, synchronized with `LiveMonitoringView`.
  - In-app service launches (`ServiceController.start()`) run without `--headless`, ensuring the `pystray` Windows system tray icon and context menu appear consistently whether started via the desktop application or CLI runner.
  - **Frozen Binary Background Process Execution (`sys.frozen` Dispatching):** In PyInstaller standalone mode (`PIISentinel.exe`), `sys.executable` points to the application executable itself rather than `python.exe`. `ServiceController.start()` dynamically detects `getattr(sys, 'frozen', False)` and spawns `[sys.executable, "--service"]` (falling back to `[python_exe, "-m", "service.service_runner"]` in development). The application root entry point (`main.py`) intercepts `--service` / `-m service.service_runner` before initializing Qt, routing execution immediately to `service.service_runner.main()` and bypassing `QApplication` / `MainWindow` creation. This eliminates duplicate GUI windows and ensures background services run cleanly.
  - **Packaging Dependencies (`packaging/pii_sentinel.spec`):** Bundles all service and watcher dependencies (`uvicorn`, `fastapi`, `starlette`, `watchdog`, `pystray`, `win10toast`, `service`, `file_watcher`) via `hiddenimports` and `collect_submodules`, guaranteeing the self-contained executable contains all runtime components.
- **Settings View (`ui/views/settings_view.py`):**
  - Tab 1: `⚙️ General & Scan Defaults` (confidence threshold, extensions, Tesseract/Java diagnostics, theme switcher).
  - Tab 2: `🛡️ Real-Time Enforcement Policy` (scoped real-time entity selection with View/Edit modal, tier action dropdowns, fail-safe mode toggle, monitored folder manager, quarantine archive path, live service probe tester, and Office add-in registration status).
- **UI Design System, Scrollbars & Performance Architecture (`ui/theme.py`, `ui/views/scan_view.py`, `ui/components/log_viewer.py`):**
  - Token-based design supporting Dark Mode ("Obsidian Slate") and Light Mode ("Studio Slate").
  - Light mode contrast prioritized: pure white card surfaces (`#ffffff`) on cool neutral slate canvas (`#f8fafc`), high-contrast dark slate typography (`#0f172a`), subtle slate borders (`#e2e8f0`).
  - **High-Performance Hardware-Accelerated Scrollbars (`QScrollBar`):** Replaced Windows native scrollbar rendering with sleek, borderless 10px rounded scrollbars for both dark and light modes with zero-height arrows, eliminating repaint overhead across `QScrollArea`, `QPlainTextEdit`, and `QTableWidget`.
  - **Asynchronous Folder Preview (`FolderPreviewWorker`):** Background thread recursively enumerates directories in `ScanView`, ensuring typing or selecting large directory paths never hitches the UI thread.
  - **Smooth ScrollArea & Log Console:** Enabled `viewport().setAttribute(Qt.WA_OpaquePaintEvent, False)` on root scroll area, set explicit document margins on `LogViewer`, and optimized log appending via direct vertical scrollbar targeting.
  - Section headers: overhauled `QGroupBox::title` styling to render cleanly as bold integrated section headers rather than floating pill badges.
  - Scan View Telemetry Deck: modernized progress section with a responsive 5-chip `StatCard` deck (`Files Scanned`, `Files with PII`, `Total Findings`, `Scan Rate` in f/s, and `Elapsed Time`).

### 8.6 Testing Suite

- `tests/test_backend.py` (16 tests): Core scanner, recognizers, database, classification, redaction, and SQLite WAL mode tests.
- `tests/test_enforcement_service.py` (15 tests): Validates policy mapping, resolve_action dual path, FastAPI endpoints (`/health`, `/classify/text`, `/classify/file`, `/enforcement/log`, `/policy`, `/service/stop`), ServiceController methods, loopback & shared-secret token authentication rejection (403), DPAPI password encryption, and schema validation with forbidden extras.
- `tests/test_file_watcher.py` (5 tests): Validates quarantine bridge encryption, plaintext file deletion, SQLite event logging, debouncing ignore rules, unwatched directory exclusion, and benign file preservation.
- `tests/test_interception_log.py` (4 tests): Validates enforcement schema, multi-filters, CSV export, and UI helper badges.
- `tests/test_realtime_entities.py` (4 tests): Validates decoupled 36-entity real-time configuration and policy push.
- `tests/test_ui.py` (7 tests): Validates MainWindow, tab navigation, results filtering, dialogs, and settings persistence.
- `tests/test_drive_scanner.py` (6 tests): Validates fixed physical drive discovery, optical/network partition exclusions, system drive path-anchoring vs non-system drives, and noise/system path filtering.
- `tests/test_watermark_backup.py` (4 tests): Validates byte-for-byte pre-mutation backup, undo rollback, modification collision guard, and retention pruner.
- `tests/test_watermark_engine.py` (9 tests): Validates format-specific watermarking across DOCX, XLSX (with `&&` ampersand escaping), PPTX (with non-colliding master shape IDs), PDF, images, non-destructive NTFS ADS metadata tagging (with explicit failure detection), dry-run backup omission, and pre-flight locked/in-use file detection.
- `tests/test_watermark_workflow.py` (4 tests): Validates end-to-end watermark review dialog, tier batch selection, filtering, database registry updates, and dry-run zero-backup verification.
- Run complete test suite (75 tests passing):
  ```powershell
  python -m unittest discover tests
  ```

---

## 9. Phase 3A: DSPM Full-Drive Scanning & Data Protection Layer

### 9.1 Multi-Drive / Full-System Scanning (`backend/drive_scanner.py`)
- **Fixed Physical Drive Enumeration:** Uses `psutil.disk_partitions(all=False)` filtered by `opts` containing `"fixed"` with fallback to `win32file.GetDriveType(mountpoint) == win32file.DRIVE_FIXED`. Strictly filters out removable media (USB sticks, SD cards), optical drives (CD/DVD), and network shares (SMB).
- **Dual-Category Exclusion Matching:** System path exclusions (`Windows`, `Program Files`, `Program Files (x86)`, `$Recycle.Bin`, `ProgramData`, `AppData\Local\Temp`) are path-anchored strictly against the active `SystemDrive` (`os.getenv("SystemDrive", "C:")`). User folders with system names on non-system drives (e.g. `D:\Windows` or `D:\Backups\Windows`) are scanned normally to prevent scan evasion. Name-anywhere exclusions (`node_modules`, `.git`) match by bare folder name across any drive.
- **Per-Session Confirmation Guard:** Switching to "Full System Scan" mode prompts the user with an explicit scope confirmation dialog once per application session (managed in-memory via `self._full_system_scan_confirmed` on `ScanView`, avoiding permanent persistent bypass across separate app launches).
- **Fast Tree Pruning:** In `backend/scanner.py`, `_count_eligible_files` mutates `dirnames[:]` in-place during `os.walk`, pruning excluded subtrees immediately without recursive traversal overhead. Configurable from user preferences (`system_scan_exclusions`).

### 9.2 Format-Aware Watermarking Engine (`backend/watermark_engine.py`)
- **Polymorphic Strategy Architecture:** Implements `WatermarkStrategy` abstract base with concrete strategy classes:
  - `DocxWatermarkStrategy`: Inserts formatted footer classification text and diagonal WordArt VML shape (`w:pict`) into the header XML using `python-docx`.
  - `XlsxWatermarkStrategy`: Sets centered top header and bottom footer classification banners across all worksheets using `openpyxl`. Automatically escapes literal `&` characters to `&&` in the template and tier strings so Excel formatting codes (`&B`, `&12`, etc.) are never corrupted.
  - `PptxWatermarkStrategy`: Adds diagonal watermark text boxes to slide masters and slides using `python-pptx`. When injecting shapes into slide masters (`master.element.spTree`), shape IDs are dynamically re-numbered to guaranteed non-colliding IDs (`max_id + 1` / `900001+`), preventing PowerPoint repair-on-open corruption warnings.
  - `PdfWatermarkStrategy`: Generates an in-memory transparent diagonal overlay page via `reportlab` and overlays onto each page via `pypdf.PageObject.merge_page`.
  - `ImageWatermarkStrategy`: Composites rotated semi-transparent alpha text overlays over image files using `Pillow`.
  - `PlaintextAdsWatermarkStrategy`: Non-destructive metadata tagging. Primary tagging via NTFS Alternate Data Stream (`<path>:pii-sentinel-classification`). If the ADS write fails (e.g. non-NTFS volume), the strategy immediately fails and records status `failed` in `file_watermarks` registry; it never claims success on partial or failed writes. Secondary Windows shell property store (`System.Comment`) is applied as an Explorer enhancement.
- **Pre-Flight Open/Locked File Check:** `is_file_open_or_locked()` inspects candidate files before mutation. Detects Office sibling lock files (`~$<filename>`) and attempts non-blocking exclusive read/write access. If the file is open elsewhere, it returns `SKIPPED_FILE_IN_USE` without taking backups or mutating disk bytes, prompting the user to close the file before watermarking.
- **Idempotency via SHA-256:** Queries `file_watermarks` registry; if file has `watermark_status == 'applied'` with identical SHA-256 content hash, skips to prevent stacking duplicate watermarks.
- **Dry-Run Mode (Safe & Fast Evaluation):** When `dry_run=True`, candidate eligibility, sensitivity tier, and SHA-256 content hashes are resolved and returned as `PENDING` without performing any disk mutations and without copying files into the backup directory. Byte-for-byte pre-mutation backups are strictly deferred until actual mutation (`dry_run=False`).
- **Platform Dependencies:** Uses declared `pywin32>=306` dependency in `requirements.txt` for Windows shell property store (`win32com.propsys`) and low-level drive type enumeration (`win32file`).
- **Configurable Watermark Template:** Customizable template supporting `{tier}`, `{date}`, `{time}`, `{filename}` placeholders.

### 9.3 Pre-Mutation Backup & Rollback Safety Net (`backend/watermark_backup.py`)
- **Byte-for-Byte Pre-Mutation Backups:** Copies original file to `%APPDATA%\PIISentinel\watermark_backups\<content_hash>\<filename>` only upon mutation (`dry_run=False`).
- **Rollback / Undo Action:** Restores original file byte-for-byte from backup store.
- **Modification Collision Guard:** Detects whether the file was altered by the user after watermarking; warns and aborts rather than overwriting unsaved user edits.
- **Automated Retention Pruning:** Configurable retention window (default: 30 days); prunes expired backup directories from disk and logs results.

### 9.4 Classification Registry & Schema Extensions (`backend/database.py`)
- **Scans Table Migration:** Added `scan_source TEXT DEFAULT 'directory_scan'` (supports `'directory_scan'` and `'full_system_scan'`).
- **Findings Table Migration:** Added `watermark_status`, `watermark_method`, `watermark_applied_at`, `watermark_backup_path`, `content_hash_sha256`.
- **File Watermarks Table (`file_watermarks`):** High-performance registry table with indexes on `file_path`, `content_hash_sha256`, and `watermark_status` for fast idempotency lookups, candidate batching, and cross-scan rollback tracking.
- **SQLite WAL Mode & Concurrency Architecture:** Database initializes with `PRAGMA journal_mode=WAL;` and connections execute `PRAGMA synchronous=NORMAL;` with connection timeout 30.0s, eliminating single-writer table locks and contention across concurrent scanner worker threads, file watcher events, and API audit logs.
- **Known Limitation & Roadmap Note (Phase 3D):** The `file_watermarks` registry is keyed by `file_path`. Renaming or moving a watermarked file on disk orphans its previous registry record, meaning the newly moved path appears unwatermarked on subsequent scans. This will be revisited in Phase 3D when central telemetry/metadata indexing allows content-hash-first primary lookups across the endpoint fleet.

### 9.5 Scanner Performance Hardening & Concurrency Architecture

- **Dynamic Worker Pool Scaling (`backend/scanner.py`, `backend/config.py`):**
  - Replaced the legacy hardcoded 8-worker ceiling with host-derived dynamic scaling: `max(8, min((os.cpu_count() or 4) * 2, 32))`.
  - UI controls in `ScanView` (`slider_workers`) and `SettingsView` (`spin_workers`) dynamically discover host CPU cores and adjust ranges (1 to host ceiling), permitting multi-core systems to execute up to 32 concurrent workers during full-system sweeps.
- **Extension-Filter Syscall Short-Circuiting:**
  - In `backend/scanner.py` (`_count_eligible_files`), file extension checking (`ext in self.supported_extensions`) evaluates purely as an in-memory string comparison directly on the filename before any path joining, exclusion evaluation, or filesystem `os.stat()` calls.
  - Excluded extensions (e.g. system files, browser caches, Python bytecodes) avoid all OS stat syscall overhead during deep directory traversals.
- **Deliberate Deferred Architecture Decision — Hybrid Thread+Process Pipeline:**
  - *Current Concurrency Model:* Uses `ThreadPoolExecutor` to execute extraction and detection tasks. This provides high throughput for I/O-bound Apache Tika extraction and disk read operations.
  - *GIL Limitation:* The Presidio/spaCy NLP entity detection stage is CPU-intensive and partially bounded by Python's Global Interpreter Lock (GIL), meaning threads do not achieve 100% multi-core CPU utilization during the classification phase.
  - *Future Hybrid Roadmap:* A hybrid architecture (`ThreadPoolExecutor` for asynchronous I/O and Tika extraction dispatch + a small `ProcessPoolExecutor` sized near `os.cpu_count()` for CPU-bound Presidio/spaCy classification, with the spaCy model initialized once per process via an initializer rather than per-task) is the designated design when fleet-scale throughput demands it.
  - *RAM-vs-CPU Tradeoff:* This is deliberately deferred because each worker process requires its own loaded spaCy NLP pipeline instance (~400MB–500MB RAM per process, totaling 4GB–8GB on an 8–16 core machine). For a local desktop agent, the current memory-efficient thread pool remains the optimal default until full-drive scan throughput on high-core hardware becomes the primary bottleneck.

---

## 10. Phase 4: TrustFabric Licensing & Activation Integration

### 10.1 Architecture & Protocol Overview

PII Sentinel is licensed and activated by a separate backend system, **TrustFabric** (a NestJS/Prisma/PostgreSQL licensing service, not part of this repository). The two systems communicate over one narrow, well-defined protocol — the agent never sends scanned content, findings, or any PII; only an enrollment token, a hashed device fingerprint, and a self-declared name/email for accountability.

```
┌──────────────────────────────┐        HTTPS only         ┌─────────────────────────────┐
│   PII Sentinel (this repo)   │ ─────────────────────────▶ │   TrustFabric Licensing API │
│   backend/license_client.py  │ ◀───────────────────────── │   (separate repository)     │
└──────────────────────────────┘                            └─────────────────────────────┘
```

- **Register (once, at activation):** `POST /agent/register` — redeems a one-time enrollment token, creates this device's `Installation`, and returns a per-installation credential (`installationId.secret`) shown exactly once.
- **Heartbeat (ongoing):** `POST /agent/heartbeat` — re-authenticates with the stored credential, refreshes the cached policy (`ACTIVE` / `SUSPENDED` / `REVOKED` / `PENDING`), and reports the current status back to the server.
- **Policy (read-only):** `GET /agent/policy` — same response shape as heartbeat, without advancing the server's `lastHeartbeatAt`.
- **Release (on uninstall):** `POST /agent/release` — self-releases the seat back to the company's allocation.
- **Offline-Tolerant Grace Period:** The agent trusts its last successful check-in for up to `heartbeatIntervalSeconds + gracePeriodDays` (server-supplied; dev defaults are 24h + 14 days) before it must refuse to keep working — this keeps the licensing model compatible with the same offline/intermittently-connected environments this application is designed for. A known-bad state (`suspended`/`revoked`) is honored immediately regardless of grace period; only *unreachability* is tolerated.
- **Two enrollment-token flavors, two different trust levels:**
  - **Named/activation-bound token** (minted automatically when a Company Admin approves a named license request on the TrustFabric side): registration lands the Installation `ACTIVE` immediately — it was already approved before the token was ever issued.
  - **Plain/bulk token** (self-service — a company hands out one token to many potential devices): registration requires the device to also self-declare a name and company email, and lands the Installation `PENDING` — it does **not** unlock the app until a Company Admin explicitly approves it in the TrustFabric Customer Portal's Installations page. This is the flow this application actually uses.

### 10.2 Licensing Client (`backend/license_client.py`)

- **State Storage:** `%APPDATA%\PIISentinel\license.json`, **encrypted at rest via Windows DPAPI** (`win32crypt.CryptProtectData` / `CryptUnprotectData`, scoped to the current Windows user account — a copy of the file is useless on another machine or under another account). A pre-DPAPI plaintext file is still readable as graceful decay, never as an ongoing feature.
- **Transport Security (`_validate_backend_url`):** Refuses to send an enrollment token or credential to anything but an `https://` URL. The only exception is an explicit `localhost`/`127.0.0.1` carve-out for local development — never appropriate for a real deployment. Backend URL resolves in order: `PIISENTINEL_LICENSE_BACKEND_URL` env var (installer-set) → `config.json`'s `license_backend_url` → the local dev default `http://localhost:3001/api/v1`. A misconfigured value fails loudly (`LicenseConfigError`), it never silently falls back.
- **Device Fingerprint (`compute_device_fingerprint`):** Reads the machine's BIOS/SMBIOS UUID via WMI (`pywin32`, already a project dependency — no new one needed) rather than trusting a self-reported value, and SHA-256 hashes it locally before it's ever transmitted — the raw hardware serial itself never leaves the device. Falls back to a MAC-address-derived id if WMI is unavailable.
- **Bearer Credential Construction:** `state['credential']` returned by `register()` is already the full `"<installationId>.<secret>"` string per the TrustFabric protocol — `_authorized_headers()` must send it as-is (`Bearer {credential}`), never re-prepend `installationId`. Doing so once produced a real, hard-to-diagnose bug: a malformed token that the server correctly rejected as invalid, which looked identical to a genuine revocation from the client's point of view. Regression-tested (`test_35_authorized_headers_do_not_double_prefix_installation_id`).
- **`enforcement_status() -> (allowed: bool, reason: str)`** is the single source of truth for "may this app run right now," implementing the grace-period rules above plus: never-activated, and `PENDING` (awaiting admin approval) both resolve to `allowed=False` with a human-readable reason.

### 10.3 Activation UI (`ui/views/activation_dialog.py`)

- Collects **enrollment token**, **full name**, and **company email address** — all three are required client-side before attempting `register()`, though the backend is the actual enforcer (a named/activation-bound token doesn't strictly require name/email, but the form doesn't know in advance which kind of token it's holding, so it always collects both; the server simply ignores them for that path).
- Success messaging is state-aware: a `PENDING` result shows *"Request submitted — waiting for your Company Admin to approve it"*; anything landing `ACTIVE` shows *"Activated successfully."* — it never claims success when the app is actually still locked.
- A definitive rejection (`LicenseError` — bad/expired/exhausted token, wrong email domain, etc.) is shown inline; a network/connectivity failure is shown as a distinct, friendlier message, so a user can tell "my token is wrong" apart from "I'm offline."

### 10.4 Enforcement Gate (`ui/views/license_gate_window.py`, `main.py`, `service/service_runner.py`)

The application **will not run at all** — GUI or headless background service — unless `license_client.enforcement_status()` currently returns `allowed=True`. This is checked at the very top of both entry points, before anything else is constructed:

- **`main()` (GUI path):** calls `enforcement_status()` **before** constructing `MainWindow` (which eagerly builds the entire scanning UI — Scan/Results/History/Live Monitoring views — regardless of licensing state). If allowed, `MainWindow` is built and shown as normal. If not, a lightweight `LicenseGateWindow` is shown instead, and `MainWindow` is only ever constructed later, from that window's `on_licensed` callback, once actually licensed.
- **`service_runner.main()` (`--service` / headless path, e.g. Windows autostart):** the identical `enforcement_status()` check runs before the FastAPI microservice or file watcher are started at all — an autostart-launched background instance won't keep silently running if the license went bad since it was last approved, independent of whether the GUI is ever reopened to notice.
- **`LicenseGateWindow`** is the persistent replacement for an earlier "popup then exit" implementation:
  - Shows the current status with an icon/color (amber "Awaiting admin approval", red for suspended/revoked/grace-expired, gray for never-activated) and the exact reason text from `enforcement_status()`.
  - **Auto-refreshes every 30 seconds** (`AUTO_REFRESH_INTERVAL_MS`) — each refresh attempts a **live heartbeat** first (not just re-reading cached state), so a Company Admin's approval is picked up automatically without the user doing anything.
  - A "Check Now" button forces an immediate manual refresh; an "Activate…" button reopens `ActivationDialog` (first-time activation, or entering a different token).
  - The moment a refresh finds `allowed=True`, it invokes the caller-supplied `on_licensed()` callback and closes itself — `MainWindow` is constructed for the first time at that exact point, never before.
- **Background heartbeat while the app is already running (`service_runner.py`):** a daemon thread heartbeats on the server-supplied interval (24h default) once `ACTIVE`, but retries every `LICENSE_RETRY_BACKOFF_SECONDS` (5 minutes) instead while `PENDING` or offline — the whole point of `PENDING` is to notice an approval promptly, not wait a full day for it.

### 10.5 Testing Suite Additions

- `tests/test_license_client.py` (29 tests): backend-URL HTTPS validation and the localhost carve-out, DPAPI encrypt/decrypt round-trip and legacy-plaintext/corrupted-file fallback, the full offline grace-period decision matrix (not-activated / revoked / suspended / pending / within-grace / grace-expired / never-checked-in), device fingerprint stability and opacity, the `Authorization` header double-prefix regression, and mocked register/heartbeat/release network calls including the `PENDING`-response path.

---

## 11. Local Endpoint Focus & Air-Gapped Security Architecture

PII Sentinel / ClAIssify is dedicated exclusively to on-device Data Security Posture Management (DSPM) and Data Loss Prevention (DLP).
To guarantee zero data exfiltration, the architecture enforces:
1. **100% Local Discovery & Scanning**: Full physical drive enumeration, local folder walks, Apache Tika text extraction, and Presidio PII analysis execute strictly on-device in local system memory.
2. **Active Real-Time DLP Enforcement**: The local classification microservice (FastAPI on loopback `127.0.0.1:47821`) coordinates with the Office Add-In (Word/Excel pre-save guard) and file-watcher interception to block or quarantine sensitive files before exfiltration.
3. **Format-Aware Watermarking Engine**: Pre-save and batch visual watermarks (Word, Excel, PowerPoint, PDF, Images) and NTFS ADS metadata watermarks execute natively without external APIs.
4. **Offline & Standalone Operation**: While enterprise enrollment and policy synchronization via TrustFabric (`backend/license_client.py`) is supported, the desktop application runs seamlessly in standalone local mode without blocking the user when offline.

---

## 12. Phase 6: UI Design System Makeover (In Progress)

### 12.1 Goal & Design Language Source

A full visual makeover of PII Sentinel's desktop UI, explicitly directed to take its design language from **the TrustFabric Licensing suite** (`D:\Trustfabric\licencing`, specifically `apps/customer-portal`) rather than being designed independently. The intent is that PII Sentinel should visually read as part of the same product family as the licensing portals it is now integrated with (Phase 4).

**Correction during this phase:** the first pass (documented in an earlier revision of this section) extracted tokens only from `apps/customer-portal/src/app/globals.css` and `apps/trustfabric-admin/src/app/globals.css` — the shadcn default CSS variables — and concluded the portals were purely monochrome/grayscale with no accent color, plus a Dark/Light toggle carried over from PII Sentinel's own prior design. Reading the actual rendered components (`sidebar.tsx`, `header.tsx`, `overview/page.tsx`) showed this was wrong on two counts: **(1)** the shipped UI overrides those CSS-variable defaults with literal Tailwind classes in practice, and **(2)** the real look uses blue as a deliberate, consistent accent color (active nav state, primary buttons, focus rings, links) — it is not monochrome. **(3)** The portal has no Dark/Light toggle at all; it is one fixed look. All three points are corrected below, and PII Sentinel's Dark/Light toggle has been removed entirely to match.

### 12.2 Extracted Design Tokens (Corrected — Read From Actual Components)

Read from `apps/customer-portal/src/components/layout/sidebar.tsx`, `header.tsx`, and `app/overview/page.tsx`:

- **Sidebar:** a fixed near-black navy, `#0A0D14` (a literal Tailwind arbitrary-value class, not the `--sidebar` CSS variable), with a `border-zinc-800/50` divider. Inactive nav item text is `zinc-400`; hover is `zinc-200` text on a `#141824` background; the **active** nav item is `text-blue-400` with a `blue-500` icon on a `#182235` background, plus a glowing `blue-500` left-edge indicator bar. This exact scheme (`#0A0D14` / `#141824` / `#182235` / blue-400/500) is now in `ui/theme.py` as `_SIDEBAR_BG`/`_SIDEBAR_HOVER_BG`/`_SIDEBAR_ACTIVE_BG`.
- **Content area:** white (`bg-white`) page shell with a very faint gray tint behind the cards (`bg-zinc-50/40`); `ui/theme.py`'s `#contentArea` uses `zinc-50` (`#fafafa`) for this.
- **Cards:** white background, a near-invisible `border-zinc-200/60` edge, `shadow-sm`, generously rounded (`rounded-xl`). Qt/QSS has no `box-shadow` equivalent, so the shadow is not replicated — only the hairline border and radius are.
- **The one accent color is blue** (Tailwind's blue-50/400/500/600/700 — `#eff6ff`/`#60a5fa`/`#3b82f6`/`#2563eb`/`#1d4ed8`), used consistently for: active sidebar nav, primary buttons, input focus borders, table-row selection tint, progress/slider fill, and links. Semantic status colors (emerald = healthy/success, amber = warning/pending, red = danger) appear only in small icon chips and status pills, exactly as in `ui/theme.py`'s preserved badge/danger/warning/success colors.
- **Buttons/inputs:** plain white background with a `border-zinc-200` hairline border and `zinc-700` text in the default state (matches `header.tsx`'s "Refresh" button exactly); no visible border on primary/filled buttons, which are solid blue-600 with white text.
- **Typography:** `Inter`/Geist via Tailwind's `font-sans`; `ui/theme.py`'s stack leads with `"Inter"` before `"Segoe UI"`, unchanged from the first pass.

### 12.3 What's Done

- **`ui/theme.py` fully rewritten a second time** as a single `THEME_QSS` (no more `DARK_THEME_QSS`/`LIGHT_THEME_QSS` pair) matching the tokens in §12.2: near-black `#0A0D14` sidebar with blue-accented active/hover nav states, white content on a faint zinc-50 tint, white cards with a hairline zinc-200 border, and blue-600 primary buttons/focus rings/selection tints throughout. All existing object names (`#sidebar`, `#primaryButton`, `.card`/`QGroupBox`, `#statCard`, etc.) were preserved, so every view picks up the look with no per-view code changes. `get_theme_qss()` still exists and still accepts a `theme_name` argument for backward compatibility with any leftover call sites, but the argument is now ignored — there is only one theme.
- **The Dark/Light toggle was removed entirely**, per explicit instruction, not just left unused:
  - `ui/main_window.py`: deleted `btn_theme_toggle` (the top-bar button) and its layout placement, `_toggle_theme()`, and the `theme_changed_signal` connection in `_wire_signals()`. `_apply_initial_theme()` now just calls `self.setStyleSheet(get_theme_qss())` once at startup.
  - `ui/views/settings_view.py`: deleted the entire "Appearance & Display" `QGroupBox` (the theme combo box and its hint label) from the General tab, the `theme_changed_signal` class attribute, `_on_theme_combo_changed()`, `sync_theme()`, and every `combo_theme`/`config_manager.theme` reference in `load_settings()`/`save_settings()`/`reset_defaults()`. The now-unused `Signal` import was removed too.
  - `backend/config.py`'s `theme` config key/property was deliberately left alone (harmless residual default, not worth the risk of touching a shared config module for a purely cosmetic cleanup).
- Deliberately **not** touched: the offline/status badge (`#badgeOffline`, restyled as a light emerald pill to sit correctly on the now-white top bar, but still semantically green), the danger/warning/success button variants, and `backend/classifier.py`'s `TIER_METADATA` sensitivity-tier colors — functional signals, not decoration, per Rule 11 in §7.
- Verified by byte-compiling every touched file, and headlessly instantiating (`QT_QPA_PLATFORM=offscreen`) both `CloudView` (under the new single theme) and `SettingsView` (to confirm removing the Appearance card and its wiring didn't break the other two tabs) — both construct without error.
- **Found and fixed a real bug via a user-provided screenshot**, not caught by the headless checks above: the sidebar's brand title (`🛡️ PII SENTINEL`) and the footer's status labels (`Java Missing`, `SaveGuard: Offline`) rendered invisible. Root cause: `theme.py`'s generic `QWidget {{ background-color: #ffffff; ... }}` rule paints *every* widget — including plain `QLabel`s with no `objectName` — with an opaque white background in Qt Style Sheets; it does not behave like CSS's transparent-by-default inheritance. Labels sitting on the dark sidebar were therefore painting a white box behind their own text (visible in the screenshot as blank space where the title should be). Fix: removed `background-color` from the generic `QWidget` selector entirely (kept only `color`/font/selection there) and added a dedicated `QMainWindow {{ background-color: #ffffff; }}` rule for the overall window background; every container that legitimately needs its own background (`#sidebar`, `#sidebarFooter`, `#topBar`, `#contentArea`, `.card`/`QGroupBox`, form controls, etc.) already had an explicit rule and was unaffected. Verified with a minimal headless repro (a bare `QFrame#sidebar` containing an unstyled `QLabel`) that samples actual rendered pixel colors: the label area now reads `rgb(10,13,20)` (`#0a0d14`, the sidebar color) instead of white, while a `QPushButton` in the same container still correctly renders its own white background from its explicit rule.
- **Found and fixed inline dark-theme leftovers in `ui/views/scan_view.py`**, via a second user screenshot showing "Active Detection Configuration:" as an apparent blank gap: `hdr_lbl` had `color: #e2e8f0` (near-white) hardcoded, invisible on the now-white card — not a spacing bug, invisible text. While in that file, also fixed three other pre-Phase-6 leftovers sitting inside otherwise-white cards: `card_category_summary`'s dark navy box (`#0d1322`) and a section divider (`#1e293b`) were re-skinned to light zinc tones, and `btn_view_all_files`/`btn_view_entities` had their dark inline button styles removed so they inherit the shared theme's default button look instead.
- **Found and fixed a separate, systemic bug: a lone `&` in text passed to `QGroupBox`, `QPushButton`, `QCheckBox`, `QRadioButton`, or a `QTabWidget` tab label is silently treated as a Qt mnemonic marker and stripped from display** (e.g. `QGroupBox("Scan Scope & Target")` rendered as "Scan Scope  Target" — the ampersand vanishes, leaving the double space from the string's own `" & "` — which is what a user screenshot surfaced as apparent "overlapping/misaligned text"). This does **not** affect `QLabel` (unless `setBuddy()` is used, which this codebase never does), `QComboBox` items, or `QLineEdit` placeholder text — confirmed empirically via `QFontMetrics`/`sizeHint` width comparisons (a mnemonic-stripped string's rendered width exactly matches the same string with the `&` removed and the surrounding spaces left in place; an escaped `&&` matches the width of a single literal `&`), not assumed from memory. Every genuinely affected string project-wide was found via a targeted grep and fixed — 10 in `ui/views/settings_view.py` (`QGroupBox` titles, one `QCheckBox`, two tab labels) and one in `ui/components/pii_selector_dialog.py` (a shared "badge" string also displayed via `QLabel` elsewhere, so it was escaped only at its two `QPushButton`/`QCheckBox` call sites with `.replace("&", "&&")` rather than mutating the shared value, which would have broken the `QLabel` use). The existing `"Engine && Concurrency Settings"` / `"Live Scan Progress && Telemetry"` titles in `scan_view.py` already used the correct `&&` escape, confirming this was a known-but-inconsistently-applied convention rather than an unknown pattern.
- **Not yet done, found in passing:** `ui/components/pii_selector_dialog.py` (`PiiViewerDialog`'s active-entities summary) still has its own dark navy inline box (`background: #0d1322; border: 1px solid #1a253a`) predating Phase 6, the same class of leftover already fixed in `scan_view.py`. Left alone in this pass since no screenshot has surfaced it as a visible problem yet and it's outside the two issues actually reported — tracked here so it isn't lost.
- **Replaced `QGroupBox`-based cards with a new `ui/components/card.py` `Card` widget in `scan_view.py`**, after a screenshot showed the "Scan Scope & Target" title sitting directly on the card's top border with no breathing room. Root cause was structural, not a spacing value to tweak: `QGroupBox` draws its title *overlapping* the card's own top border (like an HTML `<fieldset><legend>`), which is fundamentally different from the portal's actual `Card`/`CardHeader`/`CardTitle`/`CardDescription` components, where the title lives inside the card body with normal padding. `Card` (title, optional description, then a `.body_layout` callers add their content to) replicates that structure properly. All four cards in `scan_view.py` (`Scan Scope & Target`, `PII Detection Types`, `Engine & Concurrency Settings`, `Live Scan Progress & Telemetry`) were migrated, each gaining a short muted description line matching the portal's `CardDescription` pattern; `QGroupBox` is no longer imported in that file. `theme.py` gained matching `QFrame#card`/`#cardTitle`/`#cardDescription` rules (the pre-existing `.card, QGroupBox` rule was left untouched for other views not yet migrated — see the `pii_selector_dialog.py` item above). Verified two ways: headlessly instantiating `ScanView` and confirming all four `Card` children construct with the right titles, and measuring actual rendered pixel positions (`QWidget.mapTo`) to confirm 19px of real spacing between the card's top edge and its title text, versus the ~0px overlap `QGroupBox` produced.
- **Restyled `QRadioButton`'s indicator** in `theme.py` (Qt's default is a small, dated-looking dot) to a modern filled-ring style — a thin gray circle that fills with a blue ring on selection — matching the checkbox's existing blue-accent treatment, applied globally so `scan_view.py`'s "Target Directory"/"Full System Scan" radios picked it up with no per-view change.
- **Removed a redundant inline button style**: `scan_view.py`'s "Edit PII Detection Types..." button had its own hardcoded blue `setStyleSheet(...)` that happened to already match `#primaryButton` — switched it to `setObjectName("primaryButton")` instead, so it reads from the shared theme like every other primary action button rather than duplicating the same colors in two places.
- **Found and fixed the same invisible-text bug in `ui/views/cloud_view.py`**, via a third user screenshot showing the page title and the "How this works" info box both reading as blank/near-invisible: `lbl_title` had `color: #f8fafc` (near-white) and `notice_lbl` had `color: #e2e8f0` (near-white), both leftover from when this view was first built mid-session, before the Phase 6 light-theme rewrite — the same root cause as the sidebar and `scan_view.py` bugs, just never audited in this file since it was built after those fixes started but before the full sweep. Fixed to `#18181b` (title) and `#1e3a8a`, a dark blue that reads clearly against the notice box's pale blue tint (info-box-on-tinted-background is a standard pattern, not just "make it black"). Verified by pixel-measuring both labels post-fix: title luminance 25 (near-black, was ~230+/invisible), notice text luminance 75 (dark blue, matching `#1e3a8a`'s actual computed luminance, also was ~230+/invisible before).
- **Migrated `cloud_view.py`'s three `QGroupBox` cards to the `Card` component** in the same pass, for the same reason and with the same benefit as the `scan_view.py` migration: proper title placement and added description lines ("AWS Connection", "Run a Scan", "Cloud Scan Results" each gained a short muted description). `QGroupBox` is no longer imported in this file either.

### 12.4 What's Still Planned (Not Yet Done)

- **Inline QSS scattered across other views was not touched in this pass.** `ui/views/results_view.py`, `ui/views/settings_view.py`'s remaining inline-styled widgets (Java/OCR status badges, `QListWidget` styles), and others still hardcode hex colors via `setStyleSheet(...)` rather than reading from `ui/theme.py` — these still show the old dark-navy look until migrated. This is the largest remaining chunk of the makeover.
- `ui/views/onboarding_dialog.py`, `ui/views/activation_dialog.py`, `ui/views/license_gate_window.py`, `ui/views/watermark_review_dialog.py` have not been reviewed for the makeover yet.
- No real-machine visual QA has been done yet for the base theme — only headless, non-crashing verification plus a user-provided screenshot of the *previous* (monochrome, dual-theme) iteration, which is what prompted the §12.2 correction.

### 12.5 Dashboard Redesign (In Progress) — Icons, Top Bar, Sidebar, Greeting Header

Prompted by a user-supplied mockup of a fuller "SaaS dashboard" treatment for the app (search bar + user profile in the top bar, icon-based sidebar nav, a personalized greeting header, option-card-style scan-scope selection, category chips, and extra trust/quick-action cards). This resolved the open icon/emoji question from §12.4 above: **Lucide icons were adopted**, the same set `lucide-react` provides the licensing portals, rather than continuing with emoji.

**What's done:**
- **`ui/icons.py` + `packaging/assets/icons/*.svg`**: 30 Lucide SVG icons (ISC/MIT-licensed, fetched directly from `unpkg.com/lucide-static`) bundled into the repo. Lucide's raw SVGs use `stroke="currentColor"`, which only resolves inside a browser's CSS cascade, so `icon(name, color, size)` string-replaces it with an explicit hex color and renders via `QSvgRenderer` into a cached `QPixmap`/`QIcon` at request time — one set of source files serves every color/size the app needs, rather than pre-baking per-color static assets.
- **Confirmed via `QFontMetrics`-style empirical testing (not assumed) that QSS cannot re-color an already-set `QIcon` pixmap based on a button's checked/hover state** — icon pixmaps are baked at creation time. Rather than pre-rendering and swapping two icon variants per nav button on every state change, sidebar nav icons use one neutral tone (`zinc-400`, matching the inactive text color) uniformly; only the button's background/text color change between states, which QSS still handles natively.
- **Dark/Light toggle explicitly NOT reintroduced**, despite the reference mockup showing one — confirmed with the user first, since Phase 6 had explicitly removed it days earlier and the mockup's inclusion of one was a direct contradiction worth resolving rather than guessing either way.
- **`ui/main_window.py` sidebar**: brand block redone (a small blue rounded badge holding a white Lucide shield icon, next to "PII SENTINEL" / "Protect What Matters" — the old "Enterprise Privacy & Audit Suite" tagline and the separate "100% OFFLINE" pill beneath it were dropped, since the mockup folds that reassurance into the footer checklist instead); all six nav buttons now carry a Lucide icon; the first nav item was renamed from "Scan Directory" to "Dashboard" (using the `home` icon) rather than adding a literal duplicate seventh nav item, since the mockup's "Dashboard" page content is the same scan-configuration UI that page already showed — this was a judgment call, flagged here rather than assumed silently correct.
- **Sidebar footer rebuilt**: live service-status line + inline Start/Stop button (moved here from the top bar - see below), a live Java-runtime status line (`_refresh_java_status_label()`), a three-line assurance checklist (Zero Telemetry / Local Processing / Enterprise Ready — verified true statements about this build, not marketing copy borrowed uncritically from the mockup), and a version + "Privacy & Help" link row (version pulled as the real `1.0.0` from `main.py`, not the mockup's arbitrary placeholder `v1.2.0`).
- **Top bar rebuilt**: the old "AIR-GAPPED ENVIRONMENT..." badge and the Service Online/Offline + Start/Stop control were removed from here (the badge moved into the Dashboard page itself, see below; the service control moved into the sidebar footer above) and replaced with a search box (`Ctrl+K` focuses it via `QShortcut`; Enter runs a small keyword-to-tab router in `_on_search_submitted()` - a real but intentionally basic implementation, not a full fuzzy command palette) and a user-profile block. **This app has no login/account system** - "the user" shown is simply the Windows account running the scanner (`getpass.getuser()`), formatted into a display name and avatar initials, with a static "Local Scanner" role label; this was a deliberate substitution for the mockup's example "Kavyansh Mehta" so the app doesn't ship literally hardcoded to one person's name. The avatar's chevron opens a small real `QMenu` (Settings, Privacy & Help), not a decorative dead button.
- **`ui/views/scan_view.py` Dashboard header**: replaced the static "Enterprise Directory Scanner" title with a time-of-day greeting (`Good morning/afternoon/evening, {first name}`) plus the Service Online/Offline badge relocated from the old top bar (`_update_service_badge()`, pushed live by `MainWindow._on_live_status_changed()` alongside the sidebar footer's own status line - one source of truth, two displays).
- **A new "Your Data Stays Here" trust card** added beneath the Engine & Concurrency Settings card in the right column, matching the mockup's card of the same name and content (all four bullet claims - no telemetry, no file uploads, no external APIs, enterprise-grade privacy - are already true of this build, not new claims).
- Verified via a real, non-trivial debugging pass, not just `py_compile`: headless `MainWindow()` construction genuinely hung (confirmed via `tasklist` process inspection, not assumed) because `_check_first_run()` calls `OnboardingDialog(self).exec()` when `first_run_complete` is `False` in the persisted config - a modal `.exec()` blocks forever with no user present to dismiss it. This is pre-existing, correct behavior for a real interactive first run, not a bug introduced here; the headless verification script was adjusted to patch `first_run_complete = True` in-memory only (never written back to the real config file) rather than the application code being changed. With that bypass, full `MainWindow` construction, all 6 stacked views, all 4 Dashboard cards, and the new service badge were confirmed present and correctly wired.

**What's still planned (not yet done):**
- **Option-card-style scan-scope selection** (the mockup's bordered, icon-labeled "Target Directory" / "Full System Scan" boxes with a blue highlight on the selected one) - the plain `QRadioButton` pair in `scan_view.py` was left as-is; building a proper selectable-card widget is a real small-component task, not a copy-paste change.
- **PII category chips as individual checkable tiles** (the mockup's "India IDs (6)" / "Financial (0/4)" / etc. grid, each its own bordered card with an icon) - the existing dark summary-strip UI in `scan_view.py`'s "PII Detection Types" card was left untouched; converting it is a moderate rework of `_update_category_summary()`'s rendering, not just styling.
- **"Quick Actions" card (Load Preset / Save Configuration)** - deliberately not built, because it isn't a styling change: there is no existing feature to save/load a named scan configuration, so buttons for it would either do nothing or need new persistence work invented on the spot. Flagged rather than faked.
- **Full command-palette behavior for the search box** - `Ctrl+K` + Enter-to-jump is real but intentionally minimal (a fixed keyword list per nav tab); fuzzy matching across every setting/feature (as the mockup's placeholder text implies) is a larger feature, not implemented.
- No real-machine screenshot of this dashboard redesign has been taken yet - only headless construction and widget-presence verification.

### 12.6 Card Layout Bug Fix & PII Category Tiles

A real-machine screenshot of the "PII Detection Types" card showed a large, unexplained empty gap between its title and description, and between its description and the body content below. Diagnosed as a genuine Qt layout bug, not a spacing value to tweak: `ui/components/card.py`'s `Card` widget built its title/description/body as a plain `QVBoxLayout` with no `addStretch()` at the end. When a `Card` sits in a horizontal row next to a taller sibling (here, `scan_view.py`'s right column stacking the Engine & Concurrency card plus the new "Your Data Stays Here" trust card, both taller than the PII Detection Types card's own content), Qt stretches the shorter `Card` to match the row's height - and with no stretch absorber, it distributes that leftover space *between* the title, description, and body instead of collapsing it below the content. Fixed by adding `outer.addStretch()` after the body layout in `Card.__init__`. Verified by a synthetic before/after measurement (a short card next to a 15-line-tall sibling) and again inside the real `ScanView`: the title-to-description gap is now exactly the intended 14-15px spacing value, not an inflated, stretch-distributed one.

While addressing that screenshot, also finished an item flagged as deferred in §12.5: the "PII Detection Types" card's old dark text-strip category summary (`"IN India: 6/6 - Secrets: 0/7 - ..."`) was replaced with five individual checkable tiles (India IDs, Financial, Personal, Secrets, Gov & IDs - each showing a live `(active/total)` or `(count)` label and a short description), matching the reference mockup. Each tile's checkbox toggles every entity in that `ENTITY_CATEGORIES` group on/off at once (`_on_category_tile_toggled`), supports a partially-checked tri-state when some but not all of a category's entities are active, and `_update_category_summary()` (kept under its original name so every existing call site - `_load_entities`, `_set_entity_checked`, `_on_edit_entities`, select/deselect-all - needed no changes) now refreshes the five tiles instead of rewriting the old text label. The "X of 36 Types Active" badge and a new "Manage Types" button (opening the same `PiiSelectorDialog` as before) moved into `Card`'s title row via a new optional `header_widget` parameter, matching the portal's `CardHeader`-with-trailing-action pattern (e.g. "Company Utilization" + "View all companies" in the customer-portal's own overview page) - a small, backward-compatible addition to `Card` since every existing `Card(...)` call omits it and is unaffected.

**Follow-up correction:** a second screenshot showed the gap hadn't disappeared - it had only moved, now sitting as empty space *below* the "View Current PII Types"/"Edit PII Detection Types..." buttons instead of between the title and body. `Card`'s `addStretch()` fix (§12.6 above) was working exactly as designed - it collapses leftover space to one place instead of spreading it out - but it didn't address *why* there was leftover space to begin with: `entity_group` was still being vertically stretched by its `QHBoxLayout` parent (`config_layout`) to match the height of the taller sibling column. The real fix belongs at that parent layout, not inside `Card`: `config_layout.addWidget(entity_group, 3)` was changed to `config_layout.addWidget(entity_group, 3, Qt.AlignTop)`, which tells `QHBoxLayout` to size the widget to its own `sizeHint()` and align it to the top of the row instead of stretching it to fill the row's height. Verified by comparing `entity_group.height()` to `entity_group.sizeHint().height()` after layout - they're now equal (241px both), confirming the card renders at its natural content height with no forced empty space, regardless of how tall its sibling column is.

### 12.7 Exact Enterprise Palette & Spec-Driven Dashboard Rebuild (In Progress)

The user supplied a complete, literal design brief (product identity, an exact hex palette, per-card copy, exact nav item names/subtitles, a state matrix for Ready/Scanning/Paused/Completed/Error, and a 16-point visual QA checklist) directing a close rebuild against a reference screenshot, explicitly overriding the earlier "match the TrustFabric portal" sourcing (§12.1-§12.6) with a named enterprise-cybersecurity palette instead. This is a large, multi-part spec being worked through in priority order, not a single change - what's below is what has been completed and verified so far in this pass; the rest is tracked honestly as remaining, not assumed done.

**Done so far:**
- **`ui/theme.py` fully re-colored** to the exact specified hex values (`_PRIMARY_NAVY #0B1626`, `_SIDEBAR_BG #101C2D`, `_SIDEBAR_ACTIVE_BG #18345A`, `_BLUE #1677FF`, `_BLUE_ACTION #1769E0`, `_BLUE_LIGHT_BG #EEF5FF`, `_APP_BG #F5F7FA`, `_TEXT_PRIMARY #152238`, `_TEXT_SECONDARY #64748B`, `_TEXT_MUTED #94A3B8`, `_BORDER #DCE3EC`, `_SUCCESS #15966B`/`_SUCCESS_BG #EAF8F1`, `_WARNING #D98A00`/`_WARNING_BG #FFF7E6`, `_DANGER #D92D20`/`_DANGER_BG #FFF0EF`, `_DISABLED #CBD5E1`), replacing the portal-derived zinc/blue scale everywhere in that file. Sidebar hover/border shades not given explicit values in the brief (`_SIDEBAR_HOVER_BG #16273D`, `_SIDEBAR_BORDER #1C2C42`) were interpolated reasonably between the given sidebar/active values, flagged here rather than presented as spec-given.
- **Nav item names/subtitles reverted and corrected to the brief's exact list**: "Scan Directory" with "Scan files for sensitive data", plus a subtitle line under every nav item ("View findings and take action", "Past scans and reports", "Real-time file monitoring", "Configure and system status") - a new `#sidebarNavSubtitle` QSS rule and a restructured `_create_nav_button()` (now takes the subtitle and adds both the button and the subtitle label directly to the sidebar layout, since a `QPushButton` can't natively render two independently-styled text lines).
- **Sidebar footer redone to the brief's exact content**: a colored status dot + "Service: Online/Offline" + "All systems operational", version + Privacy/Help row - the earlier session's three-line assurance checklist (Zero Telemetry/Local Processing/Enterprise Ready) was removed from here since the brief doesn't call for it in this location (that content now belongs to the top-bar "Zero Telemetry" chip and the still-pending "Air-Gapped Environment" card).
- **Top bar rebuilt to the brief's three-status-chip + avatar structure**: a live Service Online/Offline chip (green/red dot + two-line status, kept in sync with the sidebar's own status dot and `ScanView`'s badge via the existing `_on_live_status_changed()` - one source of truth, three displays now), a static "Zero Telemetry / All processing local" chip, and a machine-identity chip using the real hostname (`socket.gethostname()`, not a placeholder) with a monitor icon - a `monitor.svg` icon was missing from the earlier Lucide fetch and was downloaded to complete the set. Thin vertical separators between chips via a small `_add_separator()` helper. The user avatar block (initials + chevron menu) was kept from the earlier session, recolored to the new blue.
- Verified via headless `MainWindow()` construction (with the same in-memory `first_run_complete` bypass documented in §12.5) that the renamed nav button, the top-bar chips, and the sidebar status dot all construct correctly and update together when `_on_live_status_changed(True/False)` is invoked.

**Not yet done (explicitly, not silently skipped):**
- Numbered blue step-circle badges (1/2/3/4) on each main-content card.
- Exact card-by-card copy and structure from the brief: "Scan a different target →" / "View Details →" links on the Scan Scope card; renaming the progress card to "Scan Control & Progress" with a "View Scan Logs →" link and a Ready/Scanning/Paused/Completed/Error status badge; renaming the trust card to "Air-Gapped Environment" with its exact subtitle and four-item checklist copy.
- The full Ready/Scanning/Paused/Completed/Error state matrix as an explicit, testable state machine (today the Start/Pause/Cancel button enable/disable logic exists in `_on_start_scan`/`_on_worker_finished`/etc. but has not been audited line-by-line against the brief's matrix).
- Re-coloring the remaining inline hex colors scattered through `scan_view.py` (category tiles, trust card, buttons) and `settings_view.py` to the new named palette - they still use the previous session's zinc/blue/emerald tones.
- The exact typography scale (28-32px page titles, etc.), the search box's in-field "Ctrl + K" pill (approximated here as a separate label beside the field rather than an overlay inside it), and a pass against the brief's full 16-point visual QA checklist.
- No real-machine screenshot of this palette/structure pass has been taken yet.

**Follow-up fix - clipped subtitle text:** a screenshot of the sidebar showed every nav item's subtitle line (e.g. "Scan files for sensitive data") with its top few pixels cut off, legible only from mid-letter-height down. Cause: `theme.py`'s `#sidebarNavSubtitle` rule used a **negative** top margin (`margin: -6px 12px 2px 12px`) to pull the subtitle visually closer to its nav button above - but a negative margin in Qt Style Sheets shifts the widget's painted position without correspondingly growing the space the layout reserves for it, so the label was given less vertical room than its own text needed and the top of each line was clipped by whatever painted above it. Fixed by removing the negative value (`margin: 0px 12px 4px 12px`) and relying on the sidebar layout's own tight 4px item spacing to keep the subtitle close to its button instead. Verified two ways: an isolated label's rendered height (16px) now exceeds its font's required line height (10px) where before the margin could shrink it below that; and inside the real, fully-constructed sidebar, the first subtitle's actual geometry confirms the same 16px height, matching the isolated measurement rather than being compressed by its neighbors.

**Follow-up polish - active subtitle merged into its nav item's highlight:** the next screenshot showed the clipping fixed, but the active nav item's blue highlight box only wrapped the icon+title row - its subtitle sat separately below on the plain sidebar background, reading as two disconnected pieces rather than one selected block. Qt Style Sheets has no selector for "the sibling label after a `:checked` button," so this can't be solved in pure QSS; it's handled in code instead. `#sidebarNavButton:checked` gained `border-bottom-left/right-radius: 0px` (squares off its bottom edge) and `_create_nav_button()` now connects each button's `toggled` signal to a new `_on_nav_toggled()` handler that sets the subtitle's own `styleSheet()` directly - active state gets the same `#18345A` background with rounded *bottom* corners (so button-top and subtitle-bottom together read as one pill shape), inactive state resets to `""` so the shared `#sidebarNavSubtitle` QSS rule takes back over. Verified by reading the actual `styleSheet()` string off the subtitle `QLabel`s in a fully-constructed `MainWindow`: the default-active item's subtitle carries the highlight styling and the others don't, and switching tabs correctly moves the highlight - old subtitle reverts to `""`, newly active one picks it up - confirming this isn't just correct at startup but stays correct as navigation changes.

### 12.8 Two-Column Layout Restructure - Fixing a Structural Gap, Not Another Stretch Bug

A further screenshot showed a large empty gray gap between the "PII Detection Types" card and the "Start Audit Scan"/Pause/Cancel row below it. This was a different root cause from §12.6/§12.7's `addStretch()`/`AlignTop` fixes, even though it looked similar: `scan_view.py`'s `config_layout` (a `QHBoxLayout`) paired a single card on the left (`entity_group`, "PII Detection Types") against a right column stacking *two* cards (`engine_group` + the trust card) - an inherently lopsided pairing, since two stacked cards are almost always taller than one. Meanwhile "Scan Control & Progress" (`progress_box`) and the Start/Pause/Cancel row lived *outside* that row entirely, as separate full-width elements added directly to `main_layout` below it. Because `config_layout`'s row height is always at least as tall as its tallest child, and the shorter `entity_group` side was already fixed (§12.7) to sit at the top of that tall row rather than stretch to fill it, the *unused remainder of the row* rendered as visible gray background between the short card and whatever full-width element came next - a structural mismatch between what was being compared side-by-side, not a missing stretch call.

The fix - matching the actual reference layout (independent left/right stacks, not single-card-vs-double-card pairing) - was to restructure the whole section into two genuinely independent `QVBoxLayout` columns inside one `QHBoxLayout`: **left column** now stacks Scan Scope & Target -> PII Detection Types -> the Start/Pause/Cancel row -> Scan Control & Progress (moved in from being separate `main_layout` children); **right column** stacks Engine & Performance -> the trust card, with its own `addStretch()` so if it ends up shorter than the left column (likely, since the left column now carries four sections to the right's two), the leftover space collapses at the bottom of the right column instead of appearing as a gap in the primary content flow. `config_layout` itself is now assembled once, at the end, with both columns (`7:3` stretch ratio) instead of being built and added mid-way through with only half its final content. Verified by measuring the actual gap between the "PII Detection Types" card's bottom edge and the "Start Audit Scan" button's top edge after the restructure: 17px, matching the column's own 16px `setSpacing()` value, versus the large multi-hundred-pixel gray gap before.

### 12.9 Eliminating the Dashboard's Horizontal Scrollbar - a Chain of Unwrapped-Text Culprits

The user reported an unwanted left-right scrollbar on the Scan Directory page with no screenshot attached; a quick clarifying question narrowed it to the main content area. This turned into the longest single diagnostic chain in this phase, because the overflow had **five separate, independently-sized contributors** stacked on top of each other rather than one bug - fixing any one alone barely moved the measured overflow, which made several intermediate fixes look like they "didn't work" until the full picture was assembled. Every number below was measured via `QScrollArea.horizontalScrollBar().maximum()` (0 = no overflow) and `QWidget.minimumSizeHint()`/`QLayout.minimumSize()` walks in a headless PySide6 process - not estimated.

**The five contributors found, in the order they were uncovered:**
1. **`ui/components/stat_card.py`'s `StatCard`** had both a Python-side `setMinimumWidth(130)` *and* an independent `#statCard { min-width: 130px; }` QSS rule enforcing the same floor a second, redundant way - and its title `QLabel` (e.g. "FILES WITH PII") had no `setWordWrap(True)`, so Qt treated its full unwrapped-text width as an unshrinkable minimum regardless of either width setting. Five of these sit in one row inside "Live Scan Progress & Telemetry," which after §12.8 lives in the narrower left column instead of spanning the full page - fixed by lowering both the Python and QSS minimums to 90-96px and adding `setWordWrap(True)` to the title label.
2. **The five PII-category tiles** in `scan_view.py` had no width constraint at all, sizing purely from their own unwrapped `QCheckBox` text ("Personal (0/11)" etc., up to ~208px each with no wrapping - `QCheckBox`/`QRadioButton` do not support word-wrap the way `QLabel` does) - constrained with `tile.setFixedWidth(128)` per tile plus `setWordWrap(True)` on each tile's description label.
3. **The "Full System Scan (All Local Fixed Drives)" `QRadioButton`** alone had a 561px `minimumSizeHint` - shortened to just "Full System Scan" with the detail moved to a tooltip, since `QRadioButton` text can't wrap.
4. **The page's own greeting subtitle** ("Scan your local directories for sensitive data. All processing happens locally on your machine.") had no `setWordWrap(True)` and alone demanded 1235px - by far the single largest individual contributor found. Fixed with one `setWordWrap(True)` call.
5. **The page-header service badge** ("🛡️ Service Online - Zero telemetry, local engines") was a single-line pill `QLabel` needing 572px - shortened to just "Service Online"/"Service Offline," since the top bar (§12.7) already shows the fuller "Local Engine Active" detail elsewhere; duplicating it here as a giant pill was both redundant and the width culprit.
6. **The "PII Detection Types" info bar** ("Zero cloud communication. All detection runs locally on this machine.") had no `setWordWrap(True)` and, at 814px, was nearly the *entire* card's 856px minimum on its own - the single biggest individual fix in this chain. One `setWordWrap(True)` call.

**Net effect**, measured at the exact same window widths throughout: before any of these fixes, 1600px width still showed 277-418px of unavoidable overflow (the container's true minimum was pinned around 1867px regardless of window size, since every tested width was below that floor); after all six fixes, 1600px and 1920px show **zero** overflow, matching `main.py`'s own default `resize(1600, 900)` (itself changed in this pass to match the design brief's stated reference viewport, up from 1180x780; minimum window size raised from 980x640 to 1180x720 to match). 1440px (the brief's stated minimum "must scale correctly" width) still shows 143px of overflow, and 1360/1180px show more - not yet fully eliminated at those narrower sizes, tracked here rather than claimed fixed. The remaining floor at those sizes is `config_layout`'s combined column minimum (still ~1525px at 1440px width, mostly from "PII Detection Types" at ~817px), and reducing it further would mean either compressing the category-tile checkboxes' own text (which have the same no-wrap limitation as the radio button in item 3) or accepting a narrower tile layout - not done in this pass.

**A methodology note worth keeping**: several times in this chain, a fix was applied, measured, and appeared to produce *zero* change in the overflow number - which looked like a caching bug (bytecode, Qt style cache) and was investigated as one (separate process runs, `py -B` to disable `.pyc` writes, explicit `__pycache__` deletion) before the real explanation surfaced each time: the fixed contributor genuinely got smaller, but a *different, larger* contributor was still setting the floor, so the aggregate number didn't move until that one was found too. The lesson generalizes: when a confirmed code change produces no measurable effect, first suspect "wrong bottleneck" over "stale cache" - re-measure the specific thing you changed in isolation before concluding the tooling is lying.

### 12.10 Sidebar Active-Item Seam - a Second Attempt at the Same Merge

A screenshot of the merged active nav item (§12.7's fix) showed the button and its subtitle still rendering as two visually separate rounded boxes with a small gap between them, rather than one seamless highlighted block. The §12.7 fix itself (squaring the touching corners, toggling the subtitle's background in code) was correct as far as it went, but incomplete: `sidebar_layout` (the sidebar's own top-level `QVBoxLayout`) has its own `setSpacing(4)`, which adds 4px between *every* pair of items added to it - including a button and its subtitle, which were still two separate items directly in that layout. That 4px, plus each widget's own small margin, reopened a visible seam between the two rounded pieces regardless of how their corners were shaped.

The fix was structural rather than another margin adjustment (deliberately avoiding a repeat of §12.5's negative-margin mistake): `_create_nav_button()` now wraps the button and subtitle in one small container `QWidget` with its own `QVBoxLayout` set to `setSpacing(0)`, and it's that *container* - not the button and subtitle separately - that gets added to `sidebar_layout`. This means `sidebar_layout`'s 4px spacing now only ever applies *between* different nav items, never between a button and its own subtitle, without needing any margin trick to fight it. Verified by measuring the actual pixel gap between the button's bottom edge and the subtitle's top edge: 1px (down from roughly 6px before), and by re-confirming the subtitle area still renders its background/text correctly (no reintroduction of the §12.5 clipping bug).

**Follow-up - the blue accent border only covered the button:** the next screenshot showed the merged block itself now reads as one seamless piece, but the `border-left: 3px solid` blue accent that marks a nav item as active only existed on `#sidebarNavButton:checked` - it stopped where the button ended, so the subtitle portion of the merged block had no accent line running alongside it. Added the matching `border-left: 3px solid #1677FF` to the subtitle's active-state stylesheet in `_on_nav_toggled()`, reducing its left padding from 33px to 30px to keep the text's visual indent unchanged now that 3px of it is spent on the border instead of padding. Verified by sampling pixel colors down a vertical strip at the border's x-position spanning the full button+subtitle height: 24 of 29 sampled rows read as the blue accent color, confirming the line now runs continuously rather than stopping partway down.

### 12.11 Custom Title Bar - Replacing the Native OS Window Frame

Per an explicit request to replace the native, OS-drawn Windows title bar with the app's own (matching how VS Code, Slack, and Discord all draw their own title bar instead of relying on the OS default) - a real functional change, not just styling, since the native title bar also provides window dragging, resizing, and minimize/maximize/close, all of which have to be reimplemented once the native frame is removed.

**Implementation** (`ui/main_window.py`):
- `MainWindow.__init__()` now sets `Qt.FramelessWindowHint`, removing the native frame entirely.
- `_build_title_bar()` builds a 36px-tall `#customTitleBar` `QFrame` (styled navy via the `_PRIMARY_NAVY` token in `theme.py`, which existed since the Phase 6.7 palette rewrite but had never actually been used anywhere until now) holding the app icon + "PII Sentinel — Windows Desktop Security Scanner" wordmark on the left, and minimize/maximize/close buttons (Lucide `minus`/`square`/`x` icons, two more added to the bundled set) on the right - the close button gets a red hover background, matching standard Windows convention, the other two a subtle navy hover.
- **Dragging**: the title bar's `mousePressEvent` calls `self.windowHandle().startSystemMove()` - the cross-platform Qt 5.15+/6 API that hands the actual move operation to the OS window manager, rather than manually tracking mouse deltas and calling `move()` every frame. This also means Windows' native drag-to-edge "Aero Snap" behavior keeps working for free, since the OS is doing the move, not application code.
- **Resizing**: since a frameless window has no native border to grab, `MainWindow` itself now overrides `mousePressEvent`/`mouseMoveEvent` with `setMouseTracking(True)` on both the window and its central widgets. `_edge_at()` checks the cursor position against a 6px margin (`_RESIZE_MARGIN`) on each side of the window and returns the matching `Qt.Edge` flag(s) (corners return two flags combined); `mousePressEvent` calls `self.windowHandle().startSystemResize(edges)` when the press lands in that margin, again delegating the actual resize to the OS; `mouseMoveEvent` sets the matching resize cursor (`SizeVerCursor`/`SizeHorCursor`/`SizeFDiagCursor`/`SizeBDiagCursor`) as a hover affordance even before a click.
- **Maximize/restore**: the title bar's maximize button and a double-click anywhere on the title bar both call `_toggle_maximize()`, which checks `self.isMaximized()` and calls `showNormal()`/`showMaximized()` accordingly; `_edge_at()` returns no edges at all while maximized, so a maximized window can't be accidentally "resized" through its now-meaningless screen-filling boundary.
- Verified structurally in a headless process: `windowFlags() & Qt.FramelessWindowHint` is set, the title bar frame exists at the correct 36px height, `_toggle_maximize()` flips `isMaximized()` in both directions correctly, and `_edge_at()` correctly returns combined corner flags at the window's corners and an empty flag set at its center. The actual mouse-drag/resize *interaction* can't be exercised in a headless offscreen process (it requires a real window manager) - only the logic feeding it was verified this way.

**Known, accepted limitations** (native WinAPI-level work, out of scope here): a frameless Qt window on Windows loses the native drop shadow and (on Windows 11) rounded corners around the whole window, and loses the Windows 11 "hover the maximize button for a snap-layout picker" menu - both would require intercepting `WM_NCHITTEST`/extending the DWM frame via `ctypes`/`pywin32`, which this change does not attempt. The window still snaps to screen edges/halves via drag (that part comes from `startSystemMove()` for free), just without the hover-menu shortcut to the same feature.

### 12.12 Sidebar Nav Buttons Rebuilt as One Widget - Abandoning the "Merge Two Boxes" Approach Entirely

After three rounds of trying to make a `QPushButton` and a separate `QLabel` subtitle *look* like one seamless block (§12.7, §12.10, §12.10's follow-up), a further screenshot still showed a faint seam between them. The explicit instruction that followed was to stop trying to merge two widgets and rebuild the combined block as one - a correct diagnosis: two independently-painted rounded boxes will always show *some* seam under close inspection (anti-aliasing edges, sub-pixel rounding, two separate border-radius calculations that can't perfectly agree pixel-for-pixel), no matter how precisely their colors, radii, and margins are matched. The only way to guarantee zero seam is to have one widget paint one background under its own content - not two.

**Rebuild** (`ui/main_window.py`'s `_create_nav_button()`): each nav item is now a single `QPushButton` that installs its own `QVBoxLayout` and draws its icon, title, and subtitle as three child `QLabel`s inside it, rather than setting the button's native `text`/`icon` properties and adding a second sibling widget below. Each child label gets `Qt.WA_TransparentForMouseEvents` so a click anywhere on the icon, title, or subtitle text still registers as a click on the button underneath rather than being silently absorbed by the label. `_on_nav_toggled()` no longer juggles two widgets' stylesheets to fake a match - it directly re-colors the three child labels (icon re-rendered via `ui/icons.py` at white vs. muted gray, title white-bold vs. gray, subtitle light-blue vs. muted) whenever the button's own `checked` state changes; the button's background/border/radius are styled once via `#sidebarNavButton`/`:hover`/`:checked` in `theme.py`, same as any normal button, since there's no second widget's styling to keep synchronized anymore.

**A regression found and fixed during verification, not before shipping it:** headlessly checking `btn.geometry()` after the rebuild showed `x=0` - the QSS `margin: 2px 12px` that previously inset each button from the sidebar's edges had stopped working entirely once the button hosted its own child layout (Qt's style-sheet `margin` property for a widget apparently doesn't compose reliably with a widget that has its own installed `QLayout`, rather than being purely content-managed by `QPushButton` internally). Fixed by removing the QSS `margin` and instead wrapping each button in a small `QHBoxLayout` with real `setContentsMargins(12, 2, 12, 2)` - a reliable, standard Qt mechanism for the exact same visual inset, added purely for spacing and holding only the one already-complete button widget (not a second styled box, so it carries none of the seam risk the earlier two-widget approach had). Verified with actual pixel measurements: `btn.geometry()` now reports `x=12` as intended, sampling just outside the button's left edge shows the plain sidebar background (confirming the inset gap exists), and sampling inside the button at five different heights (top/upper/middle/lower/bottom) shows continuous, single-surface coloring - the blue left-accent border and active background belong to one paint operation now, not two independently-rendered ones that happened to be styled to match.

### 12.13 Product Rebrand to "ClAIssify" - Cosmetic Only, Scoped Deliberately

The product was rebranded from "PII Sentinel" to "ClAIssify" (tagline "Classify. Govern. Protect.") using a new logo the user supplied as a PNG file path. Given how deeply "PII Sentinel" is embedded outside the UI - the `%APPDATA%\PIISentinel\` config/database/log folder, the Office add-in's registry key (`Software\Microsoft\Office\{app}\Addins\PIISentinel.OfficeAddin`), `User-Agent` strings sent to the backend, the installer/executable output names, and (most riskily) whatever product identifier TrustFabric's licensing backend has registered for entitlement checks - the user was asked up front to scope the rebrand rather than have that guessed at. They chose **cosmetic only**: change what a user actually sees (window titles, in-app labels, the sidebar/title-bar wordmark and logo, onboarding/activation dialog text), and leave every internal identifier - file paths, the Office add-in registry key, `User-Agent` strings, installer/exe output names, and the TrustFabric backend's registered product ID - untouched. This preserves data continuity for existing installs and avoids any risk to the licensing integration; it can be revisited as a separate, deliberate "full technical rebrand" task later if the user wants one.

**Logo asset preparation** (`packaging/assets/`): the user-provided source PNG had a plain near-white background that needed to become transparent, and the shield icon needed to be cropped away from the accompanying wordmark. A first attempt using a naive "any near-white pixel → transparent" threshold was wrong: it also punched holes through the icon's own internal white circuit-tree lines and circles, since those are legitimately white and indistinguishable from background by color alone (confirmed by sampling a center pixel and finding it partially transparent, `(255,255,255,158)`, after resize interpolation blended a transparent neighbor into what should have been solid opaque white). Fixed with a proper flood-fill: BFS outward from the four image borders only, so only background pixels *connected* to the true outside get marked transparent - enclosed internal white shapes are never reached and stay fully opaque. The crop box for isolating just the icon (excluding a stray sliver of the wordmark's "C") was tuned iteratively against a throwaway debug crop before being finalized. Final assets: `app_icon.png` (512x512, transparent, overwritten - old PII Sentinel icon preserved as `app_icon_old_backup.png`) and `app_icon.ico` (regenerated multi-resolution: 16/24/32/48/64/128/256px via Pillow's multi-size `.ico` save).

**Code changes** (`ui/main_window.py`): the sidebar "Brand Header" block's icon label (`lbl_brand_icon`) now loads `app_icon.png` directly via `QIcon(...).pixmap(34, 34)` instead of a Lucide "shield" glyph over a flat blue rounded-square background - the new logo already has its own shield shape and color, so the old badge background was removed rather than layered underneath it (a plain `get_icon("shield", ...)` fallback is kept for if the asset file is ever missing). The brand title and tagline labels switched from plain text to `Qt.RichText` with inline `<span style="color:...">` segments to reproduce the logo's own per-segment coloring: the wordmark renders "Cl" and "ssify" in the sidebar's existing white title color with "AI" in the brand blue (`#1677FF`); the tagline renders "Classify." / "Govern." / "Protect." in blue/teal/red (`#4C9AFF` / `#2DD4BF` / `#F87171` - chosen slightly brighter than the light-theme palette's `_BLUE`/`_SUCCESS`/`_DANGER` tokens so each word stays legible against the dark navy sidebar rather than reusing tones tuned for a white card background). The custom title bar's wordmark label and the window title (`setWindowTitle`) were updated to "ClAIssify — Classify. Govern. Protect." style text; both title-bar and window icons already loaded from `app_icon.png` by path and needed no code change, just the new file. `main.py`'s `QApplication.setApplicationName("ClAIssify")` was updated too (confirmed safe - the app has no `QSettings` calls anywhere, so nothing reads storage paths from the application/organization name); `setOrganizationName` was deliberately left as "Sentinel Security" since the user's rebrand was about the product name and logo, not the company.

A repo-wide but *targeted* text replacement (`"PII Sentinel"` → `"ClAIssify"`, `"PII SENTINEL"` → `"CLAISSIFY"`, matched with the space so it could never touch the space-free `"PIISentinel"` token used in paths/registry keys/User-Agent strings) was applied across every file under `ui/`, updating remaining user-visible surfaces: dialog window titles (Watermark Review, Enforcement/Interception Audit Inspector, PII type selector dialogs, Finding Inspector, License Required, Activation, Onboarding), onboarding body text, the live-monitoring "protection is now active" notification, and the watermark footer template text (`"CONFIDENTIAL — Classified by {product} — {tier} — {date} — Do Not Distribute"`) that gets stamped onto exported documents. Verified after the fact with a second grep that only the intended, space-containing string was ever matched and that every `PIISentinel` (no space) occurrence - the APPDATA path, the Office add-in registry key, and the three `User-Agent` strings - was left exactly as-is.

**Verification**: all touched files compiled cleanly (`py -B -m py_compile`). Because constructing a real `MainWindow` blocks indefinitely under the offscreen QPA platform (its `_check_first_run()` opens a modal onboarding dialog via `.exec()`, which never returns without a user to click it), the rich-text color-coding was instead verified in isolation - two throwaway `QLabel`s with the exact same `Qt.RichText` markup, rendered headlessly and screenshotted. The rendered image showed each tagline word in a visually distinct, correctly-assigned color (blue/teal/red), confirming the markup and per-segment styling work; the glyphs themselves rendered as "tofu" boxes only because the headless offscreen platform has no real font installed in this environment, not because of any bug - real Windows fonts will render normally. The new `app_icon.png` was independently confirmed to load as a valid, non-null 34x34 `QIcon` with its internal white circuit-tree details still crisp and its background still transparent.

### 12.14 Two Regressions Surfaced by the Rebrand's Text Sweep - Stale Mnemonic Escaping and a Long-Standing SVG Clipping Bug

Two follow-up screenshots after §12.13 showed sidebar nav items with a literal `&&` in "Results && Action"/"Settings && Health", and every sidebar icon rendering as an unrecognizable clipped fragment (a magnifying glass reduced to something like `( )`, a gear to `)0(`) instead of the correct Lucide glyph.

**The `&&` was leftover escaping from before the nav buttons were rebuilt as one widget (§12.12).** A single `&` in a `QPushButton`'s native `text` triggers Qt's mnemonic-underline handling, so `"Results && Action"` was originally written to *display* a literal `&` on a real button. Once `_create_nav_button()` was rebuilt to render the title through a plain child `QLabel` instead of the button's own `text` property, that escaping was no longer needed - `QLabel` doesn't treat `&` as a mnemonic marker - but the doubled ampersand was never reverted, so it started rendering literally as `&&`. Fixed by changing both strings back to a single `&` (`ui/main_window.py`, the two `_create_nav_button(...)` calls for "Results & Action" and "Settings & Health"). The `"Privacy && Help"` occurrences on the actual `QPushButton` (sidebar footer) and the `QMenu`'s `QAction` were left untouched - those two are still real button/action text, where the escaping is correct and necessary.

**The icon corruption was a real, pre-existing bug in `ui/icons.py`'s `_colored_pixmap()`, not (as first assumed) just small icons being hard to read in a compressed screenshot** - a wrong call made without re-checking against a reference image, corrected once the user posted a side-by-side comparison. `renderer.render(painter)` was being called with no target rect. Lucide's SVGs all use a `viewBox="0 0 24 24"`, and `QSvgRenderer::render(QPainter*)` with no rect argument draws using the SVG's *own* 24x24 coordinate space mapped directly onto the painter - it does not scale to fill whatever size the destination `QPixmap` happens to be. Since sidebar/toolbar icons are almost always requested smaller than 24px (18px, 16px, 14px, 12px), every icon in the app was being silently clipped to its own top-left corner instead of shrunk to fit - a magnifying glass's circle plus a random fragment of its handle, a gear's outer ring cut off leaving stray tooth shapes - which is exactly the bracket-like, garbled look in the screenshot. **Fixed** by passing an explicit target rect: `renderer.render(painter, QRectF(0, 0, size, size))`, which makes Qt scale the SVG content to fit the requested size instead of drawing it 1:1 in its native coordinate space. Verified headlessly by rendering all six sidebar icons (`search`, `clipboard-list`, `clock`, `activity`, `cloud`, `settings`) at 18px into a screenshot and visually confirming each is now a complete, correctly-proportioned icon matching the reference design - not a fragment. Because every icon in the app goes through this one shared function, this single fix corrects every icon everywhere it's used (sidebar nav, top bar, dialogs, menus), not just the sidebar.

### 12.15 App-Wide Lucide Icon Sweep - No Emojis, No Mixed Icon Sets, Anywhere

The user asked for Lucide icons to be used consistently throughout the entire application, with every manually-drawn/emoji/placeholder icon replaced, a single visual style (18-22px, 2px stroke, professional outline), and a fixed color convention: navy/gray by default, blue for active/primary, green for success/security, red only for errors/danger. They initially framed this as "install/use `lucide-react`" - that is a React/web package and cannot run inside this PySide6 desktop app, so it was explicitly not installed; the equivalent already in place from Phase 6 (§12.9-§12.14) is `packaging/assets/icons/*.svg` (the same MIT/ISC Lucide icon set, fetched as static SVGs) rendered through `ui/icons.py`'s `QSvgRenderer`-based `icon()`/`pixmap()` helpers - that pipeline is what this sweep standardized on everywhere.

**Scope of the sweep**: every emoji character used as a UI icon was found via a Unicode-range grep (`[ἀ0-῿F←-⯿☀-➿⌀-⏿️]`, run repeatedly until a repo-wide search under `ui/` returned zero matches) across 14 files - `main_window.py`, `stat_card.py`, `pii_selector_dialog.py`, `watermark_review_dialog.py`, `log_viewer.py`, `settings_view.py`, `scan_view.py`, `enforcement_details_dialog.py`, `results_view.py`, `license_gate_window.py`, `history_view.py`, `cloud_view.py`, `onboarding_dialog.py`, `activation_dialog.py`, and `live_monitoring_view.py`. Over 100 individual emoji occurrences were replaced: button/tab/menu-action icons (set natively via `QPushButton.setIcon()`, `QTabWidget.addTab(widget, icon, text)`, `QAction(icon, text, parent)`, `QComboBox.addItem(icon, text)`, `QTableWidgetItem.setIcon()`), search-box leading icons (`QLineEdit.addAction(icon, QLineEdit.LeadingPosition)`, matching the convention already used for the top bar's search box), and standalone title/status labels (rebuilt as a small icon `QLabel` + text `QLabel` pair in an `QHBoxLayout`, since a plain `QLabel` has no icon slot of its own).

**Two new shared components were added** rather than hand-rolling the same icon+text pairing everywhere, since the exact same "colored icon + colored text, swapped together on state change" pattern recurred across nearly every file:
- `ui/components/status_badge.py` - `StatusBadge(QFrame)`: a pill-shaped icon+text indicator with `set_state(icon_name, color, text, bg_color, border_color)`. Passing `icon_name="dot"` renders a filled circle via the new `dot_pixmap()` helper instead of an SVG lookup, used for classification-tier indicators (Restricted/Highly Confidential/Confidential/General/Public) where a solid color swatch reads better than an outline icon. Replaced the "Service Online/Offline" badges in `scan_view.py`/`live_monitoring_view.py`/`settings_view.py`, the Word/Excel add-in registration badges, and the enforcement-detail dialog's source/tier badges - all of which previously swapped an emoji-prefixed string on state change (e.g. `"🟢 REAL-TIME PROTECTION ACTIVE"` -> `"🔴 REAL-TIME PROTECTION STOPPED"`) and now call `badge.set_state(icon, color, text, bg_color=..., border_color=...)` instead.
- `ui/components/icon_label.py` - `IconTextLabel(QWidget)`: the equivalent non-pill icon+text row, added for completeness though `StatusBadge` ended up covering every dynamic case actually needed.
- `ui/icons.py` gained `dot_pixmap(color, size)` (a small `QPainter`-drawn filled circle, 3x supersampled for crisp anti-aliasing at tiny sizes) and named color constants - `ICON_SIZE`, `COLOR_DEFAULT` (`#64748B` navy/gray), `COLOR_ACTIVE` (`#1677FF` blue), `COLOR_SUCCESS` (`#15966B` green), `COLOR_DANGER` (`#D92D20` red), `COLOR_WARNING` (`#D98A00` amber) - so new call sites have a single source of truth for the state-color convention instead of inventing hex strings ad hoc.

**20 new Lucide SVGs were fetched** (`key-round`, `credit-card`, `landmark`, `star`, `alert-triangle`, `plus`, `folder-open`, `trash-2`, `rotate-ccw`, `x-circle`, `refresh-cw`, `download`, `copy`, `tag`, `lightbulb`, `ban`, `flask-conical`, `sliders-horizontal`, `play`, `file-spreadsheet`, plus a plain `circle` outline for `StatusBadge`'s/`IconTextLabel`'s default parameter) via the same `curl -sfL https://unpkg.com/lucide-static@latest/icons/<name>.svg` pattern established in Phase 6, saved into `packaging/assets/icons/`. The first fetch attempt used `curl -sf` (no `-L`) and silently saved unpkg's redirect-notice HTML instead of the SVG for all 20 files - caught immediately by validating each file for `<svg>...</svg>` tags before use, then re-fetched with `-L` and re-validated clean.

**Two real bugs were found and fixed while doing the sweep, not just cosmetic swaps**:
1. `ui/components/pii_selector_dialog.py`'s classification filter combo box: `_apply_filters()` extracted the tier name from the combo's selected text via `selected_class.split(" ", 1)[-1]` - a deliberate strip of a leading emoji-and-space (e.g. `"🔴 Highly Confidential"` -> `"Highly Confidential"`, since `split(" ", 1)` only splits on the *first* space). Once the combo items lost their emoji prefix, that same split logic would have then incorrectly truncated `"Highly Confidential"` down to just `"Confidential"` (splitting on the wrong space). Fixed by simplifying the line to `selected_class.strip().lower()` now that there is no prefix to strip.
2. `backend/classifier.py`'s `TIER_METADATA` dict never actually defined a `badge_emoji` key (only `badge`, a combined `"🟣 Restricted"`-style string) - three separate call sites (`history_view.py`, `settings_view.py`, `enforcement_details_dialog.py`) were calling `meta.get('badge_emoji', '⚪')`, meaning every one of them was silently always falling back to the default white-circle emoji regardless of the actual tier, a latent bug independent of this sweep. All three now read `meta.get('color', ...)` directly and render a `dot_pixmap()`/`StatusBadge` in the correct tier color instead.

**`get_source_icon()` (`enforcement_details_dialog.py`), used by three call sites (its own dialog, `history_view.py`, `live_monitoring_view.py`) plus asserted verbatim in `tests/test_interception_log.py`,** returned a combined emoji+label string (`"📄 Word"`, `"📊 Excel"`, `"👁️ Watcher"`, `"🛡️ Service"`). Split into `get_source_icon()` (now returns just the plain label) and a new `get_source_icon_name()` (returns the matching Lucide icon name: `file-text`, `file-spreadsheet`, `eye`, `shield`), with all three call sites updated to set both the plain-text `QTableWidgetItem`/`QLabel` and a separate `.setIcon()`/pixmap, and the unit test's assertions updated to the new plain-text return values.

**Deliberately left alone**: em-dashes, bullets (`•`), ellipses, and other typographic punctuation (Unicode range U+2000-U+206F) are not emoji-as-icons and were not touched. Backend-only strings that never reach a UI widget - `TIER_METADATA["badge"]`'s emoji (used in exported HTML/CSV reports via `backend/reporter.py`, a different, non-UI surface), `PIISentinel`-prefixed `User-Agent` headers, and the `%APPDATA%\PIISentinel\` paths - were left exactly as-is, consistent with every prior "cosmetic UI only" scoping decision in this session (§12.13).

**Verification**: every touched file individually and then all together passed `py -B -m py_compile`; a final repo-wide grep of `ui/` for the same emoji Unicode ranges returned zero matches. Rendered a headless sample of `StatusBadge` (all four color states), `StatCard` with the new icon names, the play/pause/square buttons, and a `QTabWidget` with icon tabs (`QT_QPA_PLATFORM=offscreen` + `.grab()` screenshot) - every icon rendered as a complete, correctly colored and proportioned shape with none of the clipping from §12.14's bug, confirming the new icon names resolve to real bundled SVG files and render correctly at their requested sizes.

### 12.16 The Sidebar Icons Were STILL Broken After §12.14 - a Second, Deeper Bug in the Same Symptom

The user reported the exact same garbled sidebar icons after §12.14's fix, twice in a row, and (understandably) grew frustrated ("wtf is so difficult to fix this"). Two distinct causes were involved, only the first of which had actually been fixed:

**First: a genuinely stale running process, ruled out and eliminated.** `tasklist` showed a `python.exe` process still running from before any of the session's fixes. A live GUI process never re-reads its own source after startup - Python loads and JITs nothing further from disk once a module is imported, so a window that's been open since before a code change will keep showing the old behavior indefinitely, no matter how correct the fix on disk is. Confirmed this wasn't the whole story by killing that process (with the user's explicit go-ahead first) and having the user relaunch: the rebrand text and `&`-escaping fixes (§12.13/§12.14) *did* show up correctly, proving the relaunch picked up fresh code - but the sidebar icons were still broken, meaning something in the icon-rendering path itself was still wrong, independent of any caching or stale-process explanation.

**Second, and the actual remaining bug: `QPushButton` does not size itself from an installed child layout.** `_create_nav_button()` (§12.12) puts icon/title/subtitle into a `QVBoxLayout` installed directly on the nav `QPushButton`, rather than using the button's native `text`/`icon` properties - correct for painting one seamless surface, but it has a side effect that went unnoticed: `QAbstractButton` (which `QPushButton` inherits from) overrides `sizeHint()`/`minimumSizeHint()` to compute a size from the button's own **native** `text()`/`icon()` via the current `QStyle` - both of which are empty here, since all real content lives in the child layout instead. Unlike a plain `QWidget`, this override does not consult the installed child layout's `sizeHint()` at all. The result: the button reports a tiny native sizeHint to whatever layout is sizing *it* (the per-item wrapper `row = QHBoxLayout(); row.addWidget(btn)`), so the sidebar allocates the button far less height than its own child layout actually needs - confirmed by direct inspection of a live-constructed `MainWindow` (`QT_QPA_PLATFORM=offscreen`, patching out the blocking first-run dialog): the button's real geometry was `QRect(12, 76, 237, 29)` - only 29px tall - and the icon `QLabel` inside it was squeezed down to `QRect(18, 10, 18, 3)`, just **3px tall**, despite holding an already-correct 18x18 pixmap. A `QLabel` does not scale its pixmap to fit a smaller allocated box (no `setScaledContents(True)` is set, deliberately, since that would distort the icon) - it simply clips, so only the top ~3px sliver of each icon painted. That thin clipped sliver, not a rendering/scaling defect in the SVG pipeline itself, is what actually produced the garbled bracket-like fragments the user kept seeing - meaning §12.14's `QRectF` fix was a real, necessary fix for a real bug (it was correctly making each icon render at full quality before this clipping truncated it down to a few pixels again), but was not sufficient on its own, and the earlier "verified working" check in §12.12 had confirmed the button's *background/border* rendered as one continuous surface without ever checking whether the button was *tall enough* to show its own content - a real gap in that verification pass.

**Fixed** two ways in `ui/main_window.py`'s `_create_nav_button()`: (1) `lbl_icon.setFixedSize(18, 18)` so the icon label's own sizeHint is never ambiguous, and (2) after all child labels have their final text/pixmap set (`self._on_nav_toggled(False, ...)`), explicitly `btn.setMinimumHeight(btn_vbox.sizeHint().height())` - reading the real, correct sizeHint from the child *layout* directly (not from the button's broken native one) and applying it as the button's own floor, so the outer sidebar layout can no longer squeeze it smaller than its content needs. Verified by re-running the same live-construction diagnostic: the button's geometry became `QRect(12, 76, 237, 51)`, the icon label `QRect(18, 10, 18, 18)` - its full, un-clipped 18x18 allocation - and a screenshot of the rebuilt sidebar showed all six icons (`search`, `clipboard-list`, `clock`, `activity`, `cloud`, `settings`) rendering as complete, correctly-proportioned glyphs matching the reference design, not fragments.

**Process lesson for this codebase going forward**: when a "click a button on a QPushButton with a custom child layout" widget is built anywhere else in this app, its `sizeHint()`/`minimumSizeHint()` must be sanity-checked directly (not just its background/border/inset), since `QAbstractButton` subclasses silently ignore installed child layouts for their own sizing - this is now the second time this exact class of bug has bitten this exact widget (once as the QSS `margin` not applying in §12.12, now as sizeHint not deriving from the child layout); the general takeaway is that mixing "native button chrome" (checkable/clickable/style-based text+icon) with "fully custom child-layout content" on the same `QPushButton` requires manually re-deriving anything the style would normally have computed automatically, sizing included.

## 13. Phase 7: Card-by-Card UI Refinement Against Reference Mockups

Starting a new phase where the user provides a current-vs-desired screenshot pair for one card at a time and each is rebuilt to match, rather than redesigning the whole dashboard in one pass (the approach used for Phase 6). Reusable pieces (a numbered step badge on `Card`, a "radio card" tile pattern, a colored status box with a headline+detail split) are added to `ui/components/`/`ui/icons.py` as they're needed so later cards can reuse them directly instead of re-deriving the same pattern.

### 13.1 "Scan Scope & Target" Card Rebuild

Rebuilt `scan_view.py`'s first card to match a reference mockup: a numbered blue step badge next to the card title, a "Scan a different target →" link at the top-right (reuses the existing browse-folder handler), two large clickable "radio card" tiles in place of plain `QRadioButton`s, a leading folder icon on the path field, and a colored status box (headline + a lighter detail line + a "View Details" link) below it instead of one plain line of text with the filenames crammed into brackets.

**`ui/components/card.py`** gained an optional `step_number` parameter: when given, a small blue circular `QLabel` badge is placed before the title in the same title row that already existed for `header_widget` (used by the "PII Detection Types" card's "Manage Types" button) - the two compose naturally since both just add widgets to one `QHBoxLayout`.

**The scope tiles** ("Target Directory" / "Full System Scan") are built by a new `_build_scope_tile()` helper using the exact same architecture as the sidebar nav buttons (§12.12): one checkable `QPushButton` with its own child `QHBoxLayout` (radio-dot icon, icon-box, title+subtitle text column), rather than a native `QRadioButton`. Having just diagnosed the sidebar nav buttons' `sizeHint()` bug in §12.16, `_build_scope_tile()` proactively calls `tile.setMinimumHeight(row.sizeHint().height())` after all child content is set, avoiding a repeat of that exact bug on day one instead of discovering it the same way again. Critically, the two tiles are still assigned to `self.radio_dir_scan`/`self.radio_full_system` and still added to a `QButtonGroup` - a checkable `QPushButton` exposes the identical `isChecked()`/`setChecked()`/`setEnabled()`/`toggled` API surface a `QRadioButton` does, so none of the roughly ten other call sites in the file that read or set these two widgets' checked/enabled state needed to change at all.

**`ui/icons.py`** gained `radio_pixmap(checked, color, size)`: a `QPainter`-drawn ring, filled with a solid center dot when checked - used for the tile's radio indicator instead of Qt's native (and much smaller, OS-themed) `QRadioButton::indicator`, so it can be sized and colored to match the tile design exactly.

**The detection-status line was restructured** from one `QLabel` whose text embedded the filenames inline in brackets (`"Detected 3 supported document(s) in selected folder: [a.txt, b.txt, c.txt]"`) into a `#scanPreviewBox` container holding a bold headline row (icon + summary + a "View Details" link) and a separate, lighter detail line underneath showing just the filenames - matching the reference mockup's two-line layout. The box's background/border now recolor per state (`neutral`/`info`/`success`/`warning`) via a small `_PREVIEW_STATE_STYLES` table and `_set_preview_state()`, and the "View Details" link (renamed from "View All Files") is now shown for *any* successful detection, not gated behind "more than 8 files" as before - the reference design shows it even for a single detected file.

### 13.2 A Second Widespread Bug Found Mid-Refinement: Generic Type Selectors in `setStyleSheet()` Cascade to Children

The user's very next screenshot of the rebuilt status box showed a second, smaller rounded rectangle drawn tightly around just the headline text, and another around the detail line beneath it - looking exactly like a "box within a box." The instinctive first read (informed by this session's repeated "headless font tofu-box" false lead in §12.13) was to assume it was another font-rendering artifact - it was not; the user's screenshot was from the real app with real fonts, and the boxes were real, separately-drawn borders.

**Root cause**: `_set_preview_state()` set the container's style via `self.preview_box.setStyleSheet("QWidget { background-color: ...; border: ...; border-radius: 8px; }")` - a **bare type selector**. Qt Style Sheets set on a widget apply within that widget's own subtree, and a type selector like `QWidget` matches *any* widget of that class or a subclass of it anywhere in that subtree - not just the widget `setStyleSheet()` was called on. Since `QLabel` (and every other Qt widget) is itself a `QWidget` subclass, this rule cascaded down and matched the two child `QLabel`s inside `preview_box` as well. Those labels' own local stylesheets set `background: transparent` (correctly hiding the inherited background) but never set `border` - and because `setStyleSheet()` only overrides the specific CSS properties a widget's own rule mentions, not properties it's silent on, the inherited `border: 1px solid ...; border-radius: 8px;` from the cascaded `QWidget` rule kept applying, drawn tightly around each label's own (word-wrapped, content-sized) bounding box.

**This is a general, easy-to-hit Qt Style Sheets trap, not a one-off mistake**: a grep across `ui/` for the same bare-type-selector pattern (`"QWidget {"`, `"QFrame {"`) turned up four more live instances of the identical bug, all introduced during Phase 6's icon sweep when several "colored notice/status box" widgets were built by giving a `QFrame`/`QWidget` container its own background+border via a `setStyleSheet()` call that used the widget's *class name* as the selector instead of its *object name*:
- `ui/components/status_badge.py`'s `StatusBadge.set_state()` - `self.setStyleSheet("QFrame { ... }")`, where `self` is itself a `QFrame` containing `lbl_icon`/`lbl_text` `QLabel`s (and `QLabel` **is** a `QFrame` subclass in Qt's class hierarchy, so this one was doubly guaranteed to match). Affected essentially every status pill in the app (service health, add-in registration, tier badges) - `lbl_icon` had no local style at all, so it was fully exposed to the inherited border/background.
- `ui/views/scan_view.py`'s PII category tiles - `tile.setStyleSheet("QFrame { ... }")`, cascading to `lbl_desc` (its description label, which set `background`-independent styling but no `border` override).
- `ui/views/settings_view.py`'s "notice box" widget (the Phase-2-enforcement banner) - `setStyleSheet("QFrame { ... }")` on the box, cascading to its icon and title/body `QLabel`s.

**Fixed everywhere by the same two-part change**: give the container widget an `objectName` and scope its selector to that name (`QFrame#statusBadge { ... }` instead of `QFrame { ... }`) so the rule can only ever match that one specific widget instance, never a same-typed descendant; and, as defense in depth, explicitly set `border: none; background: transparent;` on every child label inside these containers that didn't already have it, so a future similarly-scoped container style still can't leak onto them. `pii_selector_dialog.py`'s three `QLabel { color: ...; }` dialog-wide rules were checked and left alone - they only ever set `color`, never `border`/`background`, so they carry none of this risk and are a legitimate, intentional use of a type selector (deliberately setting one default text color for every label in that dialog).

**Standing rule for this codebase going forward**: `setStyleSheet()` calls that give a container its own background/border must always use an ID selector (`Type#objectName { ... }`) scoped to that widget's own `objectName`, never a bare type selector (`QWidget`/`QFrame`/`QLabel`/etc. alone) - the only safe use of a bare type selector is a rule (like `theme.py`'s app-wide base style, or `pii_selector_dialog`'s dialog-wide label color) that sets *only* properties every matching widget is meant to share, deliberately, and never `background`/`border`, which visually corrupt any descendant that doesn't explicitly override them.

### 13.3 "PII Detection Types" Card Rebuild

Second card refined against a reference screenshot. Changes, all in `scan_view.py` unless noted:

- **`ui/components/card.py`** gained a second optional parameter, `icon_name`, alongside `step_number` - a small rounded-square blue badge holding a white Lucide icon (instead of a number), placed in the same title row. A card only ever uses one or the other (a numbered step vs. a decorative category icon), so the two share one `if/elif` in `Card.__init__()` rather than needing two independent code paths. Used here with `icon_name="file-text"`.
- **The header badges** ("N of 36 types active" / "Manage Types") were restyled from a light, low-emphasis outline pill and a plain link-styled button into two fully-rounded pill shapes (`border-radius` equal to half the pill's height) with "Manage Types" now a solid blue filled pill with white text, matching the reference's stronger visual weight for the primary action. The count pill's text case was also normalized to lowercase ("6 of 36 types active") to match.
- **Each category tile's checkbox now carries a category-specific Lucide icon** via `QCheckBox.setIcon()` (which places an icon between the native check-indicator and the label text, exactly the `[checkbox] [icon] [title]` layout the reference shows) - `India PII` -> `landmark`, `Financial & Banking` -> `credit-card`, `Personal & Contact` -> `user`, `Developer Secrets` -> `key-round`, `Government & IDs` -> `shield-check`, read directly from the already-existing `ENTITY_CATEGORIES[cat_name]["icon"]` mapping (set during Phase 6's icon sweep, §12.15) rather than hardcoding a second parallel mapping.
- **The bottom "View Current PII Types" / "Edit PII Detection Types..." button row was removed entirely** - confirmed with the user first, since the reference screenshot simply not showing them was ambiguous between "cropped out of the screenshot" and "intentionally removed." The header's "Manage Types" button already opens the identical editor dialog (`_on_edit_entities`), so the removal is not a functionality loss; the now fully-orphaned `_on_view_entities()` handler and its unused `PiiViewerDialog` import were deleted with it rather than left as dead code.
- The "Zero cloud communication..." notice bar beneath the tiles was deliberately left untouched, per explicit user instruction ("dont include the cloud line") even though it also appears in the reference image - it already matched.

Verified headlessly (`QT_QPA_PLATFORM=offscreen`, `ScanView()` constructed standalone rather than the full `MainWindow`) - the icon badge, both pill badges, all five tiles with their category icons and real (not hardcoded) checked/count state, and the shortened card all rendered correctly with no leftover references to the removed buttons.

### 13.4 "Air-Gapped Environment" Trust Card Rebuild

Third card refined against a reference screenshot - the green "your data stays local" trust card stacked under the Engine settings card. Renamed from "Your Data Stays Here," its icon changed from a circular shield-check badge to a plain outline `shield`, its subtitle replaced with a single bullet-separated line ("Zero telemetry • Local engines • Your data stays here", recolored from green to a neutral gray to read as secondary/muted rather than as another accent color), its four checklist items reworded and reordered ("No data leaves your machine" / "No external API calls" / "No file uploads" / "Enterprise-grade privacy") with their checkmarks upgraded from a bare `check` glyph to a uniformly-sized `check-circle` icon, and the italic closing quote ("Privacy is not a feature...") removed entirely.

**The one genuinely new piece was the reference's large, very faint watermark shield in the card's bottom-right corner** - a purely decorative flourish with no precedent yet in this codebase. `ui/icons.py` gained `faded_pixmap(name, color, size, opacity)`: renders the normal colored icon via the existing `_colored_pixmap()`, then composites it onto a fresh transparent `QPixmap` through a `QPainter` with `setOpacity()` set low (0.10 here) - `QPainter.setOpacity()` scales the alpha of whatever is drawn next, so this yields the same icon at a fraction of its normal visual weight rather than a different color entirely.

Positioning it required a technique not used elsewhere in this codebase: the watermark `QLabel` is parented directly to the card widget but never added to the card's `QVBoxLayout` (`trust_vbox`), so the layout never manages or repositions it - it's `.lower()`-ed in z-order and then placed with a plain `.move()` to the card's bottom-right corner, offset by its own size. Because the card's width isn't fixed (it's the right column of a two-column responsive layout), the label's position has to be recalculated on every resize, not just once at construction - done by assigning a plain function directly to the card's `resizeEvent` attribute (the same "assign a function directly to a QWidget's event-handler-named attribute" technique already used for the custom title bar's drag handling in `main_window.py`, §12.11), which repositions the label and then chains to `QFrame.resizeEvent()` so the card's own normal layout recalculation still happens too.

**Verification note**: sampling the faded pixmap's center pixel directly via `QPixmap.toImage().pixel()` under the offscreen QPA platform initially read back as opaque black (`0,0,0,255`) - alarming at first glance, since the intended output was a low-alpha green. Rendered the same pixmap composited onto a copy of the card's actual light-green background color instead (the way it will really be seen, not sampled through `QImage.pixel()` in isolation) and it showed a correct, subtle, faint green shield - confirming the raw-pixel read was an offscreen-platform/`QImage` alpha-handling quirk in the diagnostic itself, not a defect in `faded_pixmap()`. Lesson: when verifying a translucency effect headlessly, composite it against a real background and inspect the *result* pixel, not the isolated transparent pixmap's raw pixel values, which can read back misleadingly under certain QPA platforms/pixel formats.

### 13.5 "Scan Control & Progress" Card - Merging Two Elements Into One, Boxed KPIs to Plain Columns

Fourth card refined - and the largest structural change of the four so far, since the reference merges what used to be two separate pieces (a bare "Primary Action Controls Bar" of three buttons sitting directly on the page background, and a distinct "Live Scan Progress & Telemetry" `Card` below it) into a single numbered step-4 card holding controls, progress, and live telemetry together.

**Header**: gained the numbered badge (`step_number=4`, reusing §13.1's `Card` addition), a "View Scan Logs →" link, and a live status pill (`StatusBadge`, reusing §13.3's component) cycling through Ready (gray) / Scanning (blue) / Paused (amber) / Cancelling (red) / Completed (green) / Error (red) as the scan progresses - previously this state was only ever communicated by overwriting one sentence in the "current file" label (`"Scanning: x.txt"`, `"Scan paused."`, `"Cancelling scan..."`, `"Scan finished: DONE"`), which is also why that label needed to be freed up for its new job below.

**"View Scan Logs"** required storing the page's root `QScrollArea` as `self.scroll_area` (it was previously a local variable in `_init_ui()`, discarded once construction finished) and adding a public `LogViewer.expand()` method rather than reaching into the log viewer's private `_is_collapsed`/`_toggle_collapse()` from `scan_view.py` - `_on_view_scan_logs()` calls `self.log_viewer.expand()` then `self.scroll_area.ensureWidgetVisible(self.log_viewer)`.

**Controls + progress bar are now one row**, not stacked: the three buttons sit to the left, and a `QVBoxLayout` to their right holds a "Progress" caption with the percentage at its far end (`self.lbl_progress_pct`, a plain `QLabel` set alongside every `progress_bar.setValue()` call) above a thin `QProgressBar` with `setTextVisible(False)` - previously the percentage was the bar's own centered native text.

**The five boxed `StatCard` KPI tiles were replaced with a new, much lighter component**, `ui/components/metric_column.py`'s `MetricColumn` - a bare label-over-value pair with no icon, box, or accent color, matching the reference's plain compact data row. It intentionally exposes the exact same `set_value()`/`get_value()` public API `StatCard` has, so most of the dozen call sites across `_on_start_scan()`/`_on_worker_progress()`/`_on_worker_finding()`/`_on_worker_finished()` needed no logic changes, only construction swapped from `StatCard(title, val, color, icon)` to `MetricColumn(title, val)`.

Two of the five slots changed identity, not just style, and needed real logic changes:
- **"Total Findings" was dropped from the visible row entirely** - the reference's five columns are Files Scanned / PII Findings / Current File / Elapsed Time / Scan Rate, with no findings-count column. Its running tally is still needed internally (incremented per-finding, reported in the finished-scan summary), so it moved from a display widget (`self.card_findings`) to a plain `self._total_findings` instance attribute with identical increment/reset/finalize logic - just no longer rendered anywhere. `tests/test_ui.py`'s live-scan integration test, which asserted `self.window.view_scan.card_findings.get_value() > 0`, was updated to assert `self.window.view_scan._total_findings > 0` instead.
- **`self.lbl_current_file` changed from a full-sentence status label to a `MetricColumn`** showing just the current filename (or "—" when idle) - since the scan's *phase* is now the header's status pill's job, not this label's. `_on_worker_progress()` now calls `.set_value(display_name)` and sets the tooltip on the underlying `.label_value` directly (to show the *un-truncated full path* on hover, distinct from `MetricColumn.set_value()`'s own default tooltip-equals-value behavior).
- Elapsed time changed from a raw seconds string (`"12.3s"`) to `HH:MM:SS` (`"00:00:12"`), via a new `_format_elapsed()` static helper, and the scan-rate unit changed from the abbreviation `"f/s"` to the reference's spelled-out `"files/sec"`.

`ui/components/stat_card.py` (`StatCard`) is no longer used anywhere in the app now that this card was its last caller, but was left in place rather than deleted - it's a complete, self-contained, independently reusable component, and removing it wasn't part of what this card's redesign asked for.

Verified headlessly the same way as the prior three cards - `ScanView()` constructed standalone, the merged card's real widgets located by walking up from `self.btn_start`'s parent chain (rather than guessing fixed pixel coordinates, which broke on the first attempt once the page's vertical layout shifted from the prior cards' redesigns) and screenshotted; the numbered badge, header link and status pill, single controls+progress row, and five-column plain metrics row all rendered exactly as laid out.

### 13.6 Two-Column Row-Pairing Fix, and an Unrelated Horizontal-Scroll Regression Found and Fixed Along the Way

After seeing the merged card rendered in the real app, the user asked for two further layout adjustments to the same page: make the "Air-Gapped Environment" trust card's height match its row-neighbor ("PII Detection Types") instead of falling short with blank space beneath it, and make "Scan Control & Progress" stretch to fill the empty space to its right instead of stopping at the left column's width.

**Root cause of both, in one place**: `progress_box` (the "Scan Control & Progress" card) was still a *third* item stacked inside `left_col`, alongside `dir_group` and `entity_group` - not a full-width row of its own below the two-column grid. Since `config_layout`'s single `QHBoxLayout` row forces both `left_col` and `right_col` to the same total allocated height (the taller of the two), and `left_col`'s natural height included `progress_box`, `right_col` was being stretched to match that much larger combined height - but `right_col.addStretch()` dumped all of that extra height as blank space *after* `trust_card`, rather than growing `trust_card` itself, and `progress_box` never got to be full-width because it was inside the 70%-width `left_col` the whole time.

**Fixed two ways**: `progress_box` moved out of `left_col` entirely and added directly to `main_layout` after `config_layout`, making it a genuine full-width row (this alone fixed the "empty space to the right" complaint, since `right_col` no longer needs to stretch to match a height that includes a card that isn't even in the same row conceptually). Separately, `right_col.addStretch()` was replaced with a stretch factor on `trust_card` itself (`right_col.addWidget(trust_card, 1)`) so any leftover height `config_layout` still allocates to `right_col` (to match `left_col`'s now-shorter height of just `dir_group` + `entity_group`) grows the trust card's own green box downward to meet `entity_group`'s bottom edge, rather than leaving a gap of unstyled background under a short card. Verified by comparing geometries directly: `entity_group` and `trust_card` now end at the identical y-coordinate in every case tested, and `progress_box`'s width matches the full container width minus its margins, not just `left_col`'s share of it.

**A second, unrelated bug was found and fixed as a direct side effect of verifying the first fix**, not something the user reported: checking the page's horizontal scrollbar at a few realistic content widths (matching the app's actual sidebar-adjusted content area, not just an arbitrary large test window) showed real overflow (`horizontalScrollBar().maximum()` of 75-190px) that had nothing to do with today's two changes - re-testing confirmed the same overflow existed (at a very similar magnitude) before them too, so it wasn't a regression from this session's work, just a latent bug that happened to get noticed while re-checking this page. Root cause, found the same way as §12.9's original horizontal-scrollbar hunt: three unwrapped `QLabel`s in the "Engine & Concurrency Settings" card - `worker_guide` (the "1 (Sequential) • 2 (Balanced) • ..." caption, 650px unwrapped) and the `worker_lbl`/`thresh_lbl` captions ("Concurrent Worker Threads:" / "Minimum Confidence Threshold:") which, combined with their adjacent value-badge labels in the same `QHBoxLayout`, summed past the available width. Fixed by adding `setWordWrap(True)` to all three - confirmed via `QScrollArea.horizontalScrollBar().maximum()` returning `0` at every content width from 1300px up afterward, where it had been nonzero at everything below ~1515px before. Lesson reaffirmed from §12.9: any unwrapped `QLabel` with more than a few words is a standing risk for this kind of regression, and it's worth a quick `minimumSizeHint()`/scrollbar check on a card any time it's touched, even for changes that look unrelated to its width.

## 14. Key Architectural UI Lessons & Cross-Window Theming

Two critical UI issues were identified and resolved during comprehensive cross-platform testing:

### 14.1 The Intermediate Ancestor Style Sheet Trap (Bug 1)
Setting a style sheet directly on an intermediate ancestor widget (such as `scroll.setStyleSheet("background: transparent; border: none;")` on a `QScrollArea`) blocks type-selector rules from any further ancestor's stylesheet (including the app-wide theme) from cascading to that widget's descendants. All scroll areas throughout ClAIssify achieve borderless transparency via `setFrameShape(QFrame.NoFrame)` and rely on `theme.py`'s global `QScrollArea { background: transparent; border: none; }` rule, ensuring child buttons, cards, and labels always receive their full intended styles.

### 14.2 Cross-Window Theme Cascade for Dialogs & Message Boxes (Bug 2)
In Qt, `QMessageBox` and `QDialog` instances are separate top-level windows that do not inherit a parent `QMainWindow`'s stylesheet. Applying the stylesheet only to `MainWindow` resulted in system dialogs rendering with OS default styling and unreadable text in dark-mode environments.
To guarantee uniform appearance across the application:
1. The theme is applied at the application level: `QApplication.instance().setStyleSheet(get_theme_qss())`.
2. Explicit `QDialog, QMessageBox { background-color: {_CARD_BG}; }` rules are defined in `theme.py` to ensure consistent backgrounds, typography, and contrast on all Windows versions.

### 14.3 Unlicensed Startup Gate & Layout Scope (`LicenseGateWindow`)
When the application starts up without an active enterprise license or prior to registration, `main.py` checks `license_client.enforcement_status()`. If unlicensed, the app deliberately intercepts execution before instantiating the heavy `MainWindow` and displays the lightweight `LicenseGateWindow` (`ui/views/license_gate_window.py`).
- **Gotcha**: A missing `footer_layout = QHBoxLayout()` definition in `_build_ui()` caused a `NameError` crash (`name 'footer_layout' is not defined`) when attempting to add `btn_activate`, `btn_standalone`, and `btn_refresh`.
- **Rule**: Whenever creating modal or standalone gate windows, verify that all button bar layout containers are explicitly instantiated before widgets are attached, and test offline/unlicensed launch pathways explicitly.

### 14.4 Packaging, Frozen Asset Resolution & Build Process Locking
- **SVG & Dynamic Imports in PyInstaller**: PyInstaller does not automatically detect dynamic SVG loading via `QSvgRenderer` in `ui/icons.py`. `PySide6.QtSvg` and `PySide6.QtXml` must be declared in `hiddenimports` in `packaging/pii_sentinel.spec`. Additionally, `ui/icons.py` implements fallback path resolution checking both `sys._MEIPASS` and `Path(sys.executable).parent / "_internal"` so packaged assets load seamlessly in one-dir and one-file modes.
- **Binary File Locking During Rebuilds**: Windows locks executing `.exe` and loaded `.pyd` C-extension libraries (such as `blis/cy*.pyd` or `spacy`). Re-running `python packaging/build.py` while an instance of `PIISentinel.exe` is still open results in `PermissionError: [WinError 5] Access is denied: .../dist/PIISentinel/...`. Build scripts and developers must terminate any existing `PIISentinel.exe` processes (`Stop-Process -Name PIISentinel -Force`) prior to invoking PyInstaller.




