"""
Watermark Backup & Rollback Safety Net
Manages byte-for-byte pre-mutation file backups, hash verification,
undo/rollback operations, and retention pruning.
"""

import os
import shutil
import hashlib
import time
import logging
from pathlib import Path
from typing import Tuple, Optional, Union
from datetime import datetime

from backend.config import get_watermark_backup_dir
from backend.database import db_manager

logger = logging.getLogger(__name__)


def compute_file_sha256(filepath: Union[str, Path]) -> str:
    """Calculate the SHA-256 hash of a file efficiently in 64KB chunks."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def create_watermark_backup(
    filepath: Union[str, Path],
    backup_dir: Optional[Path] = None
) -> Tuple[str, str]:
    """
    Create a pre-mutation byte-for-byte backup of the specified file.
    Stored at: <backup_dir>/<content_hash>/<filename>

    Returns:
        Tuple[str, str]: (content_hash_sha256, backup_filepath)
    """
    path = Path(filepath).resolve()
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Source file not found for backup: {path}")

    content_hash = compute_file_sha256(path)
    root = backup_dir or get_watermark_backup_dir()
    dest_dir = root / content_hash
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / path.name

    # If backup already exists, verify its integrity
    if dest_path.exists():
        existing_hash = compute_file_sha256(dest_path)
        if existing_hash == content_hash:
            logger.debug(f"Backup already exists for {path.name} ({content_hash[:8]})")
            return content_hash, str(dest_path)

    # Perform atomic/safe byte-for-byte copy with metadata preservation
    shutil.copy2(str(path), str(dest_path))
    logger.info(f"[OK] Created pre-watermark backup for {path.name} at {dest_path}")
    return content_hash, str(dest_path)


def restore_watermark_backup(
    filepath: Union[str, Path],
    backup_path: Optional[Union[str, Path]] = None,
    expected_watermark_hash: Optional[str] = None
) -> Tuple[bool, str]:
    """
    Undo watermarking by restoring the pre-watermark backup over the target file.
    Performs safety verification against file modifications, moves, and deletions.

    Returns:
        Tuple[bool, str]: (success, status_message)
    """
    path = Path(filepath).resolve()
    file_path_str = str(path)

    # Resolve backup path from database registry if not provided directly
    if not backup_path:
        record = db_manager.get_watermark_record(file_path_str)
        if record and record.get("watermark_backup_path"):
            backup_path = record["watermark_backup_path"]
        else:
            return False, f"No backup record found in registry for: {path.name}"

    bpath = Path(backup_path).resolve()
    if not bpath.exists() or not bpath.is_file():
        return False, f"Backup file is missing from backup store: {bpath}"

    # Verify backup integrity
    original_hash = compute_file_sha256(bpath)

    # 1. Target file existence check
    if not path.exists():
        return False, f"Target file has been moved or deleted ({path}). Undo aborted."

    current_hash = compute_file_sha256(path)

    # 2. Check if already restored
    if current_hash == original_hash:
        # File is already in original state (e.g. was plaintext/ADS or previously restored)
        # Clean up any leftover NTFS ADS tag
        ads_path = f"{path}:pii-sentinel-classification"
        try:
            if os.path.exists(ads_path):
                os.remove(ads_path)
        except Exception:
            pass

        db_manager.record_watermark_reverted(file_path_str)
        logger.info(f"[OK] Watermark reverted for {path.name} (file matches pre-watermark hash)")
        return True, f"File {path.name} is already in its pre-watermark state. Registry updated."

    # 3. Modification collision check:
    # If the user edited the file AFTER watermarking, its current hash will differ from
    # both the original hash and the watermarked hash.
    if expected_watermark_hash and current_hash != expected_watermark_hash:
        msg = (
            f"File {path.name} has been modified since it was watermarked "
            f"(hash mismatch). Restoring would overwrite unsaved user edits. Undo aborted."
        )
        logger.warning(f"[WARNING] {msg}")
        return False, msg

    # 4. Perform byte-for-byte restore
    try:
        # Atomic replacement: write to temp file then replace
        temp_restore = path.with_suffix(path.suffix + ".restore_tmp")
        shutil.copy2(str(bpath), str(temp_restore))
        
        # Verify restored temp hash before committing
        temp_hash = compute_file_sha256(temp_restore)
        if temp_hash != original_hash:
            if temp_restore.exists():
                os.remove(temp_restore)
            return False, "Restored file hash verification failed. Target remains untouched."

        # Replace target
        if os.name == "nt":
            # On Windows, replace handles existing file replacement
            os.replace(str(temp_restore), str(path))
        else:
            shutil.move(str(temp_restore), str(path))

        # Remove ADS stream if present
        ads_path = f"{path}:pii-sentinel-classification"
        try:
            if os.path.exists(ads_path):
                os.remove(ads_path)
        except Exception:
            pass

        # Update database classification registry
        db_manager.record_watermark_reverted(file_path_str)
        logger.info(f"[OK] Successfully restored original {path.name} byte-for-byte.")
        return True, f"Successfully restored {path.name} to pre-watermark state."

    except Exception as e:
        logger.error(f"[ERROR] Failed to restore {path.name}: {e}")
        return False, f"Failed to restore file: {e}"


def prune_watermark_backups(
    retention_days: int = 30,
    backup_dir: Optional[Path] = None
) -> int:
    """
    Remove backup files and directories older than retention_days.

    Returns:
        int: Total number of backup directories pruned.
    """
    root = backup_dir or get_watermark_backup_dir()
    if not root.exists():
        return 0

    cutoff_seconds = time.time() - (max(1, retention_days) * 86400)
    pruned_count = 0

    try:
        for entry in os.scandir(root):
            if entry.is_dir():
                try:
                    dir_stat = entry.stat()
                    if dir_stat.st_mtime < cutoff_seconds:
                        shutil.rmtree(entry.path, ignore_errors=True)
                        pruned_count += 1
                        logger.info(
                            f"[OK] Pruned old watermark backup directory: {entry.name} "
                            f"(older than {retention_days} days)"
                        )
                except Exception as e:
                    logger.warning(f"Could not inspect/prune backup directory {entry.path}: {e}")
    except Exception as e:
        logger.error(f"Error scanning backup store for pruning: {e}")

    return pruned_count
