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
- 🔍 **Recursive Directory Auditing:** Scan deeply nested folder structures with pause, resume, and instant cancellation controls.
- 📄 **Broad Format Ingestion:** Seamlessly extracts text from **PDF, DOCX, DOC, XLSX, XLS, PPTX, PPT, CSV, TXT, RTF, HTML, XML, JSON, ODT, ODS**.
- 🧠 **Microsoft Presidio & spaCy Engine:**
  - Dynamically discovers all built-in entity recognizers at runtime (`EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `PERSON`, `IP_ADDRESS`, `US_SSN`, `IBAN_CODE`, `CRYPTO`, `DATE_TIME`, etc.).
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
  - Generates `report.csv`, structured `report.json`, and a standalone, interactive `report.html` executive dashboard with metric cards, risk distribution charts, and file risk rankings.
  - Built-in SQLite history database (`%APPDATA%\PIISentinel\history.db`) to review and reopen past scans anytime.
- ⚙️ **System Health & Diagnostics:**
  - Auto-detects Java runtimes (Eclipse Adoptium Temurin, Oracle JDK/JRE, and `JAVA_HOME`).
  - Optional Tesseract OCR toggle for scanned/image-based PDFs.
  - Native Dark and Light mode themes with persisted user preferences (`config.json`).

---

## 🏛️ System Architecture

```
PIIScanner/
├── backend/
│   ├── config.py             # User preferences manager (%APPDATA%\PIISentinel\config.json)
│   ├── database.py           # SQLite persistence for scan history (%APPDATA%\PIISentinel\history.db)
│   ├── tika_extractor.py     # Apache Tika parser with JVM auto-detection & fallbacks
│   ├── presidio_detector.py  # Presidio analyzer, dynamic entity queries, text chunking & redaction
│   ├── scanner.py            # Multithreaded directory walker with pause/resume/cancel
│   ├── reporter.py           # Auto-generates CSV, JSON, and interactive HTML dashboards
│   ├── file_ops.py           # Safe copy/move extraction (preserving paths) & quarantine zip creation
│   └── logger.py             # Rotating file logger to %APPDATA%\PIISentinel\logs\
├── ui/
│   ├── main_window.py        # MainWindow with sidebar navigation and stacked layout
│   ├── theme.py              # Modern dark & light QSS styles and color tokens
│   ├── components/
│   │   ├── stat_card.py      # KPI metric card widget
│   │   └── log_viewer.py     # Real-time color-coded log stream console
│   ├── views/
│   │   ├── scan_view.py      # Target selection, entity chips, confidence slider, controls & progress
│   │   ├── results_view.py   # Findings grid, filtering, extraction/quarantine dialogs, context menu
│   │   ├── history_view.py   # Historical scan audit trail, report reopener, deletion
│   │   ├── settings_view.py  # Extensions, file size caps, OCR toggle, Java diagnostics
│   │   └── onboarding_dialog.py # Privacy guarantee & local-first onboarding modal
│   └── workers/
│       └── scan_worker.py    # QThread worker bridge connecting backend scanner to Qt signals
├── packaging/
│   ├── pii_sentinel.spec     # PyInstaller spec file for standalone executable
│   ├── installer.iss         # Inno Setup script for single-file installer (.exe) with uninstaller
│   ├── build.py              # Automated build pipeline (PyInstaller + ISCC compiler)
│   ├── create_assets.py      # Asset generator for icons (.ico, .png)
│   └── assets/               # Application icons and branding graphics
├── tests/
│   ├── test_backend.py       # Unit and integration test suite
│   ├── test_ui.py            # Automated UI and live scan test suite
│   └── create_test_samples.py # Test document generator
├── main.py                   # Application entry point
├── requirements.txt          # Python dependencies
├── .gitignore                # Git exclusions (build, dist, cache, logs)
├── LICENSE                   # MIT License
└── README.md                 # Project documentation
```

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

Run backend tests:
```powershell
python -m unittest tests/test_backend.py
```

Run UI & integration tests:
```powershell
python -m unittest tests/test_ui.py
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
