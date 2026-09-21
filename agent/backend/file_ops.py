"""
File Operations for PII Sentinel
Handles safe extraction (copy/move preserving relative folder structure),
quarantining into encrypted/password-optional zip archives,
and operating system shell integrations (reveal in Explorer, open file).
"""

import os
import shutil
import zipfile
import logging
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)


def extract_flagged_files(
    files: List[str],
    destination_folder: str,
    root_scan_folder: str,
    move_files: bool = False
) -> Dict[str, Any]:
    """
    Extract files that contain PII to a destination folder,
    preserving their relative directory hierarchy from root_scan_folder.
    move_files: If True, moves the files (destructive). Default is False (safe copy).
    """
    dest_path = Path(destination_folder)
    dest_path.mkdir(parents=True, exist_ok=True)
    root_path = Path(root_scan_folder).resolve()

    successful = []
    failed = []

    # Eliminate duplicates while preserving order
    unique_files = list(dict.fromkeys(files))

    for src_str in unique_files:
        src = Path(src_str)
        if not src.exists():
            failed.append({"file": src_str, "error": "File does not exist"})
            continue

        try:
            # Determine relative path from scan root if possible
            resolved_src = src.resolve()
            try:
                rel_path = resolved_src.relative_to(root_path)
            except ValueError:
                # File is not under root_scan_folder, preserve drive or filename
                rel_path = Path(src.name)

            target_file_path = dest_path / rel_path
            target_file_path.parent.mkdir(parents=True, exist_ok=True)

            if move_files:
                shutil.move(str(src), str(target_file_path))
                action = "moved"
            else:
                shutil.copy2(str(src), str(target_file_path))
                action = "copied"

            successful.append({"file": src_str, "target": str(target_file_path), "action": action})
            logger.info(f"Successfully {action} '{src_str}' -> '{target_file_path}'")

        except Exception as e:
            msg = f"Failed to extract '{src_str}': {e}"
            logger.error(msg)
            failed.append({"file": src_str, "error": str(e)})

    return {
        "total": len(unique_files),
        "successful_count": len(successful),
        "failed_count": len(failed),
        "successful": successful,
        "failed": failed,
        "mode": "move" if move_files else "copy"
    }


def quarantine_flagged_files(
    files: List[str],
    zip_destination_path: str,
    root_scan_folder: str,
    password: Optional[str] = None,
    rename_originals: bool = False,
    delete_originals: bool = False
) -> Dict[str, Any]:
    """
    Quarantine files into a zip archive with optional password protection.
    Optionally renames original files to '<filename>.quarantined' or deletes them.
    Explicit opt-in is required for destructive modifications.
    """
    zip_path = Path(zip_destination_path)
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    root_path = Path(root_scan_folder).resolve()

    unique_files = [f for f in dict.fromkeys(files) if Path(f).exists()]
    archived_files = []
    failed_files = []

    # Determine whether pyzipper is available for AES encryption
    use_pyzipper = False
    if password:
        try:
            import pyzipper
            use_pyzipper = True
        except ImportError:
            logger.warning("pyzipper module not found. Falling back to standard ZipFile.")

    try:
        if use_pyzipper and password:
            import pyzipper
            zip_cls = pyzipper.AESZipFile(
                str(zip_path),
                mode="w",
                compression=pyzipper.ZIP_DEFLATED,
                encryption=pyzipper.WZ_AES
            )
            zip_cls.setpassword(password.encode("utf-8"))
        else:
            zip_cls = zipfile.ZipFile(
                str(zip_path),
                mode="w",
                compression=zipfile.ZIP_DEFLATED
            )
            if password:
                zip_cls.setpassword(password.encode("utf-8"))

        with zip_cls as zf:
            for src_str in unique_files:
                src = Path(src_str)
                try:
                    resolved_src = src.resolve()
                    try:
                        arcname = str(resolved_src.relative_to(root_path))
                    except ValueError:
                        arcname = src.name

                    zf.write(str(src), arcname=arcname)
                    archived_files.append(src_str)
                except Exception as e:
                    logger.error(f"Error adding {src_str} to quarantine zip: {e}")
                    failed_files.append({"file": src_str, "error": str(e)})

        # Optional post-archive original file handling
        modified_originals = []
        if not failed_files:  # Only modify originals if archive succeeded
            for src_str in archived_files:
                p = Path(src_str)
                if delete_originals:
                    try:
                        p.unlink()
                        modified_originals.append({"file": src_str, "status": "deleted"})
                    except Exception as e:
                        logger.error(f"Failed to delete original '{src_str}': {e}")
                elif rename_originals:
                    try:
                        quarantine_name = p.with_name(p.name + ".quarantined")
                        p.rename(quarantine_name)
                        modified_originals.append({"file": src_str, "status": f"renamed to {quarantine_name.name}"})
                    except Exception as e:
                        logger.error(f"Failed to rename original '{src_str}': {e}")

        return {
            "success": True,
            "zip_path": str(zip_path),
            "files_archived": len(archived_files),
            "files_failed": len(failed_files),
            "modified_originals": modified_originals,
            "is_encrypted": bool(password)
        }

    except Exception as e:
        logger.error(f"Quarantine archive creation failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "zip_path": str(zip_path),
            "files_archived": 0,
            "files_failed": len(unique_files)
        }


def reveal_in_explorer(file_path: str) -> bool:
    """Open Windows Explorer and select the specified file."""
    p = Path(file_path)
    if not p.exists():
        logger.warning(f"Cannot reveal non-existent path: {file_path}")
        return False
    try:
        subprocess.run(["explorer.exe", "/select,", str(p.resolve())], check=False)
        return True
    except Exception as e:
        logger.error(f"Failed to open Explorer for {file_path}: {e}")
        return False


def open_file_default(file_path: str) -> bool:
    """Launch the file using the default Windows application."""
    p = Path(file_path)
    if not p.exists():
        logger.warning(f"Cannot open non-existent file: {file_path}")
        return False
    try:
        os.startfile(str(p.resolve()))
        return True
    except Exception as e:
        logger.error(f"Failed to open file {file_path}: {e}")
        return False
