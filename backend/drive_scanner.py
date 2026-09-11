"""
Drive Scanner & System Exclusion Manager for PII Sentinel
Handles enumeration of fixed local physical drives (excluding removable, optical, and network drives)
and directory filtering for high-noise / system locations.
"""

import os
import sys
import logging
from pathlib import Path
from typing import List, Set, Optional

try:
    import psutil
except ImportError:
    psutil = None

try:
    import win32file
    import win32con
except ImportError:
    win32file = None
    win32con = None

logger = logging.getLogger(__name__)

# Standard system/noise directories that should be skipped during full drive sweeps
DEFAULT_SYSTEM_EXCLUSIONS: List[str] = [
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "$Recycle.Bin",
    "ProgramData",
    r"AppData\Local\Temp",
    "node_modules",
    ".git"
]


def get_fixed_drives() -> List[str]:
    """
    Enumerate all local fixed physical drives mounted on Windows (e.g. ['C:\\', 'D:\\']).
    Strictly excludes:
      - Removable drives (USB flash drives, SD cards)
      - Network / mapped drives (SMB shares)
      - Optical drives (CD/DVD/Blu-ray)
      - RAM disks and virtual images
    """
    fixed_drives: List[str] = []

    # Strategy 1: psutil disk_partitions inspection
    if psutil is not None:
        try:
            partitions = psutil.disk_partitions(all=False)
            for part in partitions:
                # On Windows, opts contains 'fixed' for internal hard drives/SSDs
                opts = part.opts.lower()
                fstype = part.fstype.lower()
                device = part.device.upper()
                mountpoint = part.mountpoint

                # Ensure drive is fixed and not network/cdrom
                if "fixed" in opts or (fstype in ("ntfs", "refs", "fat32", "exfat") and "cdrom" not in opts and "removable" not in opts):
                    # Verify with Win32 API if available
                    if win32file is not None:
                        try:
                            dtype = win32file.GetDriveType(mountpoint)
                            if dtype == win32file.DRIVE_FIXED:
                                if mountpoint not in fixed_drives:
                                    fixed_drives.append(mountpoint)
                                continue
                        except Exception:
                            pass
                    else:
                        if mountpoint not in fixed_drives:
                            fixed_drives.append(mountpoint)
        except Exception as e:
            logger.warning(f"psutil drive discovery warning: {e}")

    # Strategy 2: Win32 API GetLogicalDriveStrings + GetDriveType fallback
    if not fixed_drives and win32file is not None:
        try:
            drives_str = win32file.GetLogicalDriveStrings()
            drive_list = [d for d in drives_str.split('\000') if d]
            for drive in drive_list:
                dtype = win32file.GetDriveType(drive)
                if dtype == win32file.DRIVE_FIXED:
                    if drive not in fixed_drives:
                        fixed_drives.append(drive)
        except Exception as e:
            logger.warning(f"Win32 API drive discovery warning: {e}")

    # Strategy 3: Standard Windows root fallback if both libraries fail
    if not fixed_drives:
        system_drive = os.getenv("SystemDrive", "C:")
        root = f"{system_drive}\\" if not system_drive.endswith("\\") else system_drive
        if os.path.exists(root):
            fixed_drives.append(root)

    # Normalize drives to consistent format (e.g. 'C:\\')
    normalized = []
    for d in fixed_drives:
        norm = os.path.abspath(d)
        if not norm.endswith("\\"):
            norm += "\\"
        if norm not in normalized and os.path.exists(norm):
            normalized.append(norm)

    logger.info(f"Discovered {len(normalized)} fixed local drive(s): {normalized}")
    return normalized


def is_path_excluded(path: str, exclusions: Optional[List[str]] = None) -> bool:
    """
    Check whether a directory or file path falls within any exclusion rule.
    Performs case-insensitive normalization matching directory names and subpaths.
    """
    if not path:
        return False

    exclusion_rules = exclusions if exclusions is not None else DEFAULT_SYSTEM_EXCLUSIONS
    if not exclusion_rules:
        return False

    norm_path = os.path.normpath(path).lower()
    path_parts = [p.lower() for p in Path(norm_path).parts]

    for rule in exclusion_rules:
        clean_rule = rule.strip()
        if not clean_rule:
            continue

        norm_rule = os.path.normpath(clean_rule).lower()

        # Direct folder name match (e.g. 'node_modules', '.git', '$recycle.bin', 'windows')
        if norm_rule in path_parts:
            return True

        # Exact substring / subpath match (e.g. 'appdata\\local\\temp')
        if f"\\{norm_rule}\\" in f"\\{norm_path}\\" or norm_path.endswith(f"\\{norm_rule}"):
            return True

        # Prefix match from root (e.g. 'c:\\windows')
        if any(norm_path.startswith(f"{drive.lower()}{norm_rule}") for drive in ("c:\\", "d:\\", "e:\\", "f:\\")):
            return True

    return False
