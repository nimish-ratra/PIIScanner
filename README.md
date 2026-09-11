# 🛡️ PIIScanner (PII Sentinel)

[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![PySide6 / Qt](https://img.shields.io/badge/GUI-PySide6%20%2F%20Qt6-41CD52?style=flat-square&logo=qt&logoColor=white)](https://wiki.qt.io/Qt_for_Python)
[![Microsoft Presidio](https://img.shields.io/badge/NLP-Microsoft%20Presidio-0078D4?style=flat-square&logo=microsoft&logoColor=white)](https://github.com/microsoft/presidio)
[![Apache Tika](https://img.shields.io/badge/Parser-Apache%20Tika-D22128?style=flat-square&logo=apache&logoColor=white)](https://tika.apache.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25%20Local%20%26%20Airgapped-success?style=flat-square)](#-privacy--security-guarantee)

**PIIScanner (PII Sentinel)** is an enterprise-grade, local-first Windows desktop application that recursively audits directories and documents to detect, mask, extract, and quarantine **Personally Identifiable Information (PII)**.

Engineered with **Apache Tika** for universal document ingestion and **Microsoft Presidio** for advanced NER and rule-based PII identification, it features a fluid, modern **PySide6 (Qt for Python)** user interface with real-time analytics.

---

> [!IMPORTANT]
> ### 🔒 100% Local & Privacy-Guaranteed
> All document ingestion, text parsing, OCR, and NLP entity detection execute **entirely on your local machine**.
> - **Zero cloud/external API calls**
> - **Zero telemetry or tracking**
> - **Works completely offline / air-gapped**

---

## ✨ Key Features

- ⚡ **Concurrent Multi-Worker Engine:** Configurable worker threads (1–8 threads, default 2–4) configurable directly on the UI to scan and extract multiple documents in parallel for massive throughput gains.
- 🛡️ **Phase 2: Real-Time Save Enforcement Layer:**
  - **Two-Tier Enforcement Architecture:**
    - **Tier 1 (Office True Pre-Save Block):** Microsoft Word and Excel VSTO/COM Add-in intercepting `DocumentBeforeSave`/`WorkbookBeforeSave` in memory before disk write. If flagged, sets `Cancel = true` and presents a modern dark-themed WPF `BlockDialog` with sensitivity tier badge, redacted findings, and an override escape hatch requiring an audit rationale.
    - **Tier 2 (Generic File Watcher):** High-speed `watchdog` monitor observing Desktop, Documents, and Downloads with a 2.0s debounce window. When a file write completes, content is classified and automatically moved into an AES-256 encrypted zip archive, the plaintext original is removed, and a Windows toast notification alerts the user.
  - **Shared Local Classification Microservice:** FastAPI running strictly on `127.0.0.1:47821` (zero external interface binding, loopback verification middleware).
  - **Microsoft Purview 5-Tier Classification:** Classifies findings into Restricted, Highly Confidential, Confidential, General, and Public tiers with admin-configurable actions (`block`, `quarantine`, `warn`, `allow`).
  - **Fail-Safe Mode Configuration:** Fail-Closed (maximum security default) vs Fail-Open (permissive developer workflow).
- 🔍 **Recursive Directory Auditing:** Scan deeply nested folder structures with pause, resume, and instant cancellation controls.
- 📄 **Broad Format Ingestion:** Seamlessly extracts text from **PDF, DOCX, DOC, XLSX, XLS, PPTX, PPT, CSV, TXT, RTF, HTML, XML, JSON, ODT, ODS**.
- 🧠 **Microsoft Presidio & spaCy Engine:**
  - Dynamically discovers all built-in entity recognizers at runtime (`EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `PERSON`, `IP_ADDRESS`, `US_SSN`, `IBAN_CODE`, `CRYPTO`, `DATE_TIME`, `IN_AADHAAR`, `IN_PAN`, `AWS_KEY`, `GITHUB_TOKEN`, etc.).
  - Configurable confidence threshold slider (default `0.60`).
  - Granular entity selection with 1-click Select All / Deselect All.
- 👁️ **Interactive Results View:**
  - Sortable and searchable table with **redacted value previews** (e.g., `jo****om`, `41********44`).
  - Quick filtering by Entity Type, Confidence level, and File Name.
  - Context menu actions: *Open Containing Folder*, *Open File*, *Copy Path*, *Copy Value*.
- 📦 **Safe Extraction & Quarantine Operations:**
  - **Extract Flagged Files:** Copies files containing PII to a designated location while **strictly preserving original relative folder hierarchies**. Optional destructive move mode with double-confirmation safeguard.
  - **Encrypted Quarantine:** Bundles sensitive files into an AES-encrypted, password-protected ZIP archive (`pyzipper`), with optional opt-in to safely rename originals to `.quarantined` or delete them.
- 📊 **Executive Reporting & Historical Audit Trail:**
  - Dual-tab Security Audit Trail (`HistoryView`): View historical directory scans and real-time save enforcement logs.
  - Generates `report.csv`, structured `report.json`, and a standalone, interactive `report.html` executive dashboard with metric cards, risk distribution charts, and file risk rankings.
  - Built-in SQLite history database (`%APPDATA%\PIISentinel\history.db`) with `enforcement_events` table.
- ⚙️ **System Health & Diagnostics:**
  - Dual-tab Settings View: General preferences + Real-Time Enforcement Policy manager.
  - Auto-detects Java runtimes (Eclipse Adoptium Temurin, Oracle JDK/JRE, and `JAVA_HOME`).
  - Live probe testing for the local classification microservice and Office COM Add-in registration status.
  - Optional Tesseract OCR toggle for scanned/image-based PDFs.
  - Native Dark and Light mode themes with persisted user preferences (`config.json`).

---

## 🏛️ System Architecture

```
PIIScanner/
├── backend/                  # Core classification, detection, and database engine
│   ├── classifier.py         # Microsoft Purview 5-tier sensitivity engine
│   ├── config.py             # User preferences manager (%APPDATA%\PIISentinel\config.json)
│   ├── database.py           # SQLite persistence (%APPDATA%\PIISentinel\history.db)
│   ├── tika_extractor.py     # Apache Tika parser with JVM auto-detection & fallbacks
│   ├── presidio_detector.py  # Presidio analyzer, dynamic entity queries & redaction
│   ├── scanner.py            # Multithreaded directory walker with pause/resume/cancel
│   ├── reporter.py           # Auto-generates CSV, JSON, and interactive HTML dashboards
│   ├── file_ops.py           # Safe copy/move extraction & AES-256 encrypted quarantine
│   └── logger.py             # Rotating file logger to %APPDATA%\PIISentinel\logs\
├── service/                  # Phase 2: Shared Local Classification Microservice
│   ├── api_server.py         # FastAPI localhost loopback service (127.0.0.1:47821)
│   ├── enforcement_policy.py # Policy mapping (Purview Tier -> block/quarantine/warn/allow)
│   └── service_runner.py     # Background runner with system tray icon and autostart
├── office_addin/             # Phase 2: Microsoft Office VSTO/COM Add-in (Word & Excel)
│   ├── ThisAddIn.cs          # IDTExtensibility2 entry point and host application detection
│   ├── WordSaveGuard.cs      # Hooks DocumentBeforeSave event; extracts in-memory text
│   ├── ExcelSaveGuard.cs     # Hooks WorkbookBeforeSave event; extracts in-memory text
│   ├── ApiClient.cs          # Localhost HTTP client with fail-safe timeout
│   ├── BlockDialog.xaml(.cs) # Modern WPF modal dialog with rationale & override escape hatch
│   ├── PIISentinelAddin.csproj # C# .NET 4.5/4.8 project
│   └── build_and_register.ps1# Non-admin per-user COM registration script
├── file_watcher/             # Phase 2: Generic Filesystem Watcher
│   ├── watcher_service.py    # watchdog directory monitor (Desktop, Documents, Downloads)
│   ├── quarantine_bridge.py  # Automated AES-256 zip remediation & plaintext file deletion
│   └── toast_notifier.py     # Windows toast notifications (win10toast + PowerShell XML fallback)
├── ui/                       # PySide6 Desktop User Interface
│   ├── main_window.py        # MainWindow with sidebar navigation and stacked layout
│   ├── theme.py              # Modern dark & light QSS styles and color tokens
│   ├── views/
│   │   ├── scan_view.py      # Target selection, entity chips, confidence slider, controls & progress
│   │   ├── results_view.py   # Findings grid, filtering, extraction/quarantine dialogs, context menu
│   │   ├── history_view.py   # Dual-tab history: Directory Scans & Real-Time Enforcement Events
│   │   └── settings_view.py  # Dual-tab settings: General Diagnostics & Enforcement Policy
│   └── workers/              # QThread workers
├── packaging/                # Automated PyInstaller & Inno Setup scripts
├── tests/                    # Comprehensive unit and integration test suite
│   ├── test_backend.py       # Phase 1 backend unit tests
│   ├── test_ui.py            # Phase 1 UI automation tests
│   ├── test_enforcement_service.py # Phase 2 microservice and policy tests
│   └── test_file_watcher.py  # Phase 2 watcher and quarantine bridge tests
├── main.py                   # Application entry point
├── requirements.txt          # Python dependencies
├── CONTEXT.md                # AI Agent Single Source of Truth
└── README.md                 # Project documentation
```

### ℹ️ Two-Tier Enforcement Model & Known Boundaries
- **Office Documents (Word & Excel):** Uses true pre-save blocking via VSTO/COM events (`DocumentBeforeSave`/`WorkbookBeforeSave`). Text is evaluated in memory prior to disk write, enabling non-destructive `Cancel = true` cancellation.
- **Generic Files (TXT, CSV, JSON, PDF, etc.):** Uses a detect-and-remediate model. The file watcher captures file-system modification events, classifies content immediately upon write completion, moves sensitive files into AES-256 encrypted archives, and deletes plaintext originals.
- **Theoretical Phase 3 Escalation (Future Roadmap):** Pre-write blocking of arbitrary non-Office applications (e.g., Notepad, VS Code) requires a signed Windows Kernel Minifilter Driver (`fltmgr.sys`). Phase 2 intentionally implements the two-tier model to avoid kernel-mode driver signing requirements while maintaining zero data-at-rest exposure.

---

## 🚀 Getting Started

### Prerequisites

1. **Python 3.10+ (64-bit)**
2. **Java Runtime Environment (JRE/JDK 8+)**: Required by Apache Tika.
   - PII Sentinel automatically detects standard Java installations including **Eclipse Adoptium Temurin**, Oracle JDK/JRE, and `JAVA_HOME`.
3. *(Optional)* **Tesseract OCR**: Required only if scanning pure image-based documents.

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/nimish-ratra/PIIScanner.git
   cd PIIScanner
   ```

2. **Create and activate a virtual environment (recommended):**
   ```powershell
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   ```

3. **Install dependencies:**
   ```powershell
   python -m pip install -r requirements.txt
   ```

4. **Download the spaCy NLP model:**
   ```powershell
   python -m spacy download en_core_web_sm
   ```

5. **Launch the application:**
   ```powershell
   python main.py
   ```

---

## 🧪 Testing

Run all 30 tests in the complete test suite:
```powershell
python -m unittest discover tests
```

Or execute individual test suites:
```powershell
# Phase 1: Core backend, Presidio detection, Tika extraction, multi-worker scanner
python -m unittest tests/test_backend.py

# Phase 1: PySide6 Desktop UI navigation, live scan, and entity chips
python -m unittest tests/test_ui.py

# Phase 2: Local classification microservice, policy mapping & loopback security
python -m unittest tests/test_enforcement_service.py

# Phase 2: File watcher debounce, quarantine bridge, and toast notification
python -m unittest tests/test_file_watcher.py

# Phase 3A: Drive scanner, watermark engine, pre-mutation backup & rollback
python -m unittest tests/test_drive_scanner.py
python -m unittest tests/test_watermark_backup.py
python -m unittest tests/test_watermark_engine.py
```

---

## 📦 Building the Standalone Executable & Installer

The repository includes a 1-command build script in `packaging/build.py` that compiles the application with PyInstaller and builds a Windows setup installer via Inno Setup:

```powershell
python packaging/build.py
```

- **Standalone Folder:** Output generated in `dist/PIISentinel/`
- **Installer Executable:** Output generated in `dist_installer/PIISentinel_Setup_v1.0.exe` (with Desktop & Start Menu shortcuts and uninstaller)

---

## 🛡️ Privacy & Security Guarantee

- **Air-Gapped Operation:** All document analysis, entity classification, and masking occur entirely in-memory on the local host.
- **Data Protection:** No inspected file contents or extracted PII ever leave the machine or get written to unencrypted temporary files.
- **Secure Quarantine:** Quarantined archives utilize AES-256 encryption via `pyzipper` to safeguard sensitive files at rest.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
