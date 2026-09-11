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

# Standard system/noise directories split by matching strategy
PATH_ANCHORED_SYSTEM_EXCLUSIONS: List[str] = [
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "$Recycle.Bin",
    "ProgramData",
    r"AppData\Local\Temp",
]

NAME_ANYWHERE_EXCLUSIONS: List[str] = [
    "node_modules",
    ".git",
]

DEFAULT_SYSTEM_EXCLUSIONS: List[str] = PATH_ANCHORED_SYSTEM_EXCLUSIONS + NAME_ANYWHERE_EXCLUSIONS


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


def is_path_excluded(
    path: str,
    exclusions: Optional[List[str]] = None,
    path_anchored_exclusions: Optional[List[str]] = None,
    name_anywhere_exclusions: Optional[List[str]] = None
) -> bool:
    """
    Check whether a directory or file path falls within any exclusion rule.
    Applies path-anchored matching for system folders (against SystemDrive)
    and name-anywhere matching for developer noise folders (node_modules, .git).
    """
    if not path:
        return False

    norm_path = os.path.normpath(path)
    p = Path(norm_path)
    norm_path_lower = norm_path.lower()
    path_parts_lower = [part.lower() for part in p.parts]

    # Resolve exclusion lists
    if path_anchored_exclusions is not None or name_anywhere_exclusions is not None:
        anchored_rules = [r.strip() for r in (path_anchored_exclusions or []) if r.strip()]
        anywhere_rules = [r.strip() for r in (name_anywhere_exclusions or []) if r.strip()]
    elif exclusions is not None:
        # Separate caller-provided unified list into anchored vs name-anywhere
        anchored_rules = []
        anywhere_rules = []
        anchored_lookup = {r.lower() for r in PATH_ANCHORED_SYSTEM_EXCLUSIONS}
        for r in exclusions:
            clean = r.strip()
            if not clean:
                continue
            if clean.lower() in anchored_lookup or clean.startswith(("\\", "/")) or (len(clean) > 1 and clean[1] == ":"):
                anchored_rules.append(clean)
            else:
                anywhere_rules.append(clean)
    else:
        anchored_rules = list(PATH_ANCHORED_SYSTEM_EXCLUSIONS)
        anywhere_rules = list(NAME_ANYWHERE_EXCLUSIONS)

    # 1. Match name-anywhere exclusions (e.g. node_modules, .git) across any drive
    for rule in anywhere_rules:
        norm_rule = os.path.normpath(rule).lower()
        if norm_rule in path_parts_lower:
            return True
        if f"\\{norm_rule}\\" in f"\\{norm_path_lower}\\" or norm_path_lower.endswith(f"\\{norm_rule}"):
            return True

    # 2. Match path-anchored exclusions against actual SystemDrive (or explicitly specified drive roots)
    system_drive = os.getenv("SystemDrive", "C:").rstrip("\\").upper() + "\\"
    sys_drive_letter = system_drive[:2].lower()

    # Determine drive letter of scanned path
    path_drive = (p.drive.lower() if p.drive else (norm_path_lower[:2] if len(norm_path_lower) >= 2 and norm_path_lower[1] == ":" else ""))
    is_on_system_drive = (path_drive == sys_drive_letter)

    for rule in anchored_rules:
        norm_rule = os.path.normpath(rule)
        norm_rule_lower = norm_rule.lower()

        # If rule has an explicit drive letter (e.g. C:\CustomPath), test directly
        if len(norm_rule) > 1 and norm_rule[1] == ":":
            try:
                if p.is_relative_to(Path(norm_rule)):
                    return True
            except (ValueError, TypeError):
                if norm_path_lower.startswith(norm_rule_lower):
                    return True
            continue

        # For relative system rules (Windows, Program Files, AppData\Local\Temp):
        # Must only match if the path is genuinely located on the SystemDrive
        if not is_on_system_drive:
            continue

        # Subpath pattern like AppData\Local\Temp
        if "\\" in norm_rule:
            if f"\\{norm_rule_lower}\\" in f"\\{norm_path_lower}\\" or norm_path_lower.endswith(f"\\{norm_rule_lower}"):
                return True
        else:
            # Anchored to root of SystemDrive (<SystemDrive>\<norm_rule>)
            anchor = Path(system_drive, norm_rule.lstrip("\\/"))
            try:
                if p.is_relative_to(anchor):
                    return True
            except (ValueError, TypeError):
                if norm_path_lower.startswith(str(anchor).lower()):
                    return True

    return False
