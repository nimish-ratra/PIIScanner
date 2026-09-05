"""
Apache Tika Text Extraction Module
Handles Java detection, environment configuration, text extraction,
and graceful fallback/error handling for corrupted or unreadable files.
"""

import os
import sys
import shutil
import logging
import subprocess
import threading
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

logger = logging.getLogger(__name__)

def _get_silent_creationflags() -> int:
    return subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

# Known potential Java installation directories on Windows
POTENTIAL_JAVA_DIRS = [
    Path(r"C:\Program Files\Eclipse Adoptium"),
    Path(r"C:\Program Files\Java"),
    Path(r"C:\Program Files (x86)\Java"),
    Path(r"C:\Program Files\Microsoft"),
    Path(r"C:\Program Files\Amazon Corretto"),
    Path(r"C:\Program Files\BellSoft"),
]


def find_system_java() -> Optional[Path]:
    """Find a functional java.exe binary on the system."""
    # 1. Check if java is already in PATH
    java_in_path = shutil.which("java")
    if java_in_path:
        return Path(java_in_path)

    # 2. Check JAVA_HOME environment variable
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        candidate = Path(java_home) / "bin" / "java.exe"
        if candidate.exists():
            return candidate

    # 3. Search common installation directories
    for base_dir in POTENTIAL_JAVA_DIRS:
        if base_dir.exists():
            # Look for bin/java.exe in subdirectories
            for java_exe in base_dir.glob("**/bin/java.exe"):
                if java_exe.is_file():
                    return java_exe

    return None


def configure_java_environment(custom_java_path: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Configure PATH and JAVA_HOME to ensure Apache Tika can invoke Java."""
    java_exe = None
    if custom_java_path and Path(custom_java_path).exists():
        p = Path(custom_java_path)
        java_exe = p if p.name.lower() == "java.exe" else (p / "bin" / "java.exe")

    if not java_exe or not java_exe.exists():
        java_exe = find_system_java()

    if not java_exe or not java_exe.exists():
        logger.warning("No Java executable detected. Apache Tika requires Java 8+ to extract text.")
        return False, None

    java_bin_dir = str(java_exe.parent)
    java_home_dir = str(java_exe.parent.parent)

    # Prepend to PATH if not present
    current_path = os.environ.get("PATH", "")
    if java_bin_dir.lower() not in current_path.lower():
        os.environ["PATH"] = java_bin_dir + os.pathsep + current_path

    if "JAVA_HOME" not in os.environ:
        os.environ["JAVA_HOME"] = java_home_dir

    logger.info(f"Java configured successfully: {java_exe} (JAVA_HOME={java_home_dir})")
    return True, str(java_exe)


def check_java_status(custom_path: Optional[str] = None) -> Dict[str, Any]:
    """Check whether Java is installed, executable, and return its version details."""
    success, java_path = configure_java_environment(custom_path)
    if not success or not java_path:
        return {
            "available": False,
            "version": "Not Found",
            "path": "",
            "message": "Java JRE/JDK is required by Apache Tika for document parsing."
        }

    try:
        proc = subprocess.run(
            [java_path, "-version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
            creationflags=_get_silent_creationflags()
        )
        version_output = (proc.stderr or proc.stdout).strip().splitlines()
        first_line = version_output[0] if version_output else "Java detected"
        return {
            "available": True,
            "version": first_line,
            "path": java_path,
            "message": "Ready"
        }
    except Exception as e:
        logger.warning(f"Error checking Java version at {java_path}: {e}")
        return {
            "available": False,
            "version": "Error executing java",
            "path": java_path,
            "message": str(e)
        }


def check_tesseract_status(custom_path: Optional[str] = None) -> Dict[str, Any]:
    """Check whether Tesseract OCR is available on the machine."""
    tess_path = custom_path or shutil.which("tesseract")
    if not tess_path:
        # Check standard Windows paths
        default_paths = [
            Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
            Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
        ]
        for p in default_paths:
            if p.exists():
                tess_path = str(p)
                break

    if not tess_path:
        return {
            "available": False,
            "version": "Not Installed",
            "path": "",
            "message": "Tesseract OCR is optional. If absent, scanned image PDFs will be skipped."
        }

    try:
        proc = subprocess.run(
            [tess_path, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
            creationflags=_get_silent_creationflags()
        )
        first_line = proc.stdout.strip().splitlines()[0] if proc.stdout else "Tesseract OCR"
        return {
            "available": True,
            "version": first_line,
            "path": str(tess_path),
            "message": "Ready"
        }
    except Exception as e:
        return {
            "available": False,
            "version": "Error executing",
            "path": str(tess_path),
            "message": str(e)
        }


# Auto-configure Java upon module load
configure_java_environment()

_tika_lock = threading.Lock()
_tika_server_initialized = False


def _patch_tika_silent_process() -> None:
    """
    Patch tika.tika.Popen so that Tika's internal startServer calls
    run with CREATE_NO_WINDOW and SW_HIDE, preventing any cmd.exe windows
    from flashing on the screen.
    """
    try:
        import tika.tika
        orig_popen = tika.tika.Popen
        if getattr(orig_popen, "_is_silent_patched", False):
            return

        def _silent_popen(*args, **kwargs):
            if sys.platform == "win32":
                flags = kwargs.get("creationflags", 0) | subprocess.CREATE_NO_WINDOW
                kwargs["creationflags"] = flags
                startupinfo = kwargs.get("startupinfo") or subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 0  # SW_HIDE
                kwargs["startupinfo"] = startupinfo
            return orig_popen(*args, **kwargs)

        _silent_popen._is_silent_patched = True
        tika.tika.Popen = _silent_popen
    except Exception as e:
        logger.debug(f"Unable to patch tika.tika.Popen: {e}")


class TikaExtractor:
    """Extracts text content from various document formats using Apache Tika."""

    def __init__(self, max_file_size_mb: int = 50, ocr_enabled: bool = False):
        self.max_file_size_mb = max_file_size_mb
        self.ocr_enabled = ocr_enabled
        self._tika_imported = False

    def _ensure_tika(self) -> bool:
        """Lazy import and thread-safe silent initialization of Tika."""
        global _tika_server_initialized
        if self._tika_imported and _tika_server_initialized:
            return True

        with _tika_lock:
            if not self._tika_imported or not _tika_server_initialized:
                try:
                    # Ensure java path is in PATH before importing tika
                    configure_java_environment()
                    # Patch Tika subprocess to suppress all console windows
                    _patch_tika_silent_process()
                    import tika
                    # Tell Tika not to print jar download/status banners to stdout
                    tika.initVM()
                    self._tika_imported = True
                    _tika_server_initialized = True
                except Exception as e:
                    logger.error(f"Failed to initialize Tika VM: {e}")
                    return False
            return True

    def extract_text(self, filepath: str) -> Tuple[str, Optional[str]]:
        """
        Extract text from file.
        Returns: (extracted_text, error_message_or_None)
        Never throws unhandled exceptions; returns empty string on failure.
        """
        path_obj = Path(filepath)

        # 1. Check file existence
        if not path_obj.exists():
            msg = f"File not found: {filepath}"
            logger.warning(msg)
            return "", msg

        # 2. Check file size
        try:
            size_mb = path_obj.stat().st_size / (1024 * 1024)
            if size_mb > self.max_file_size_mb:
                msg = f"File exceeds maximum size limit ({size_mb:.1f} MB > {self.max_file_size_mb} MB): {filepath}"
                logger.warning(msg)
                return "", msg
        except Exception as e:
            msg = f"Unable to read file stat: {e}"
            logger.warning(f"{msg} ({filepath})")
            return "", msg

        # 3. For simple plain text and json files, we can also extract directly as a quick fast path or fallback
        ext = path_obj.suffix.lower()
        if ext in [".txt", ".json", ".xml", ".csv"]:
            try:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    return content.strip(), None
            except Exception as e:
                logger.debug(f"Direct text read failed for {filepath}, falling back to Tika: {e}")

        # 4. Use Tika for rich document formats (DOCX, PDF, XLS, PPT, ODT, etc.)
        if not self._ensure_tika():
            return "", "Tika / Java runtime initialization failed."

        try:
            from tika import parser
            headers = {}
            if not self.ocr_enabled:
                headers["X-Tika-PDFOcrStrategy"] = "no_ocr"
            else:
                headers["X-Tika-PDFOcrStrategy"] = "ocr_and_text_extraction"

            parsed = parser.from_file(filepath, headers=headers)
            if not parsed:
                return "", "Tika returned null parsed object (unsupported format or corrupted)"

            content = parsed.get("content")
            if content:
                return content.strip(), None
            else:
                return "", None  # Valid file, but no text content found (e.g. blank page or pure image without OCR)

        except Exception as e:
            err_str = str(e)
            # Differentiate common reasons
            if "password" in err_str.lower():
                msg = f"Password protected or encrypted document: {err_str}"
            elif "corrupt" in err_str.lower() or "zip" in err_str.lower():
                msg = f"Corrupted or invalid document archive: {err_str}"
            else:
                msg = f"Tika parser error: {err_str}"
            logger.warning(f"{msg} for file: {filepath}")
            return "", msg
