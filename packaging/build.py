"""
Automated Build Script for PII Sentinel
1. Builds standalone distribution using PyInstaller
2. Detects Inno Setup Compiler (ISCC.exe) and compiles single-file Windows installer
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
PACKAGING_DIR = PROJECT_ROOT / "packaging"
DIST_DIR = PROJECT_ROOT / "dist"
BUILD_DIR = PROJECT_ROOT / "build"
INSTALLER_OUTPUT_DIR = PROJECT_ROOT / "dist_installer"


def find_iscc() -> Path | None:
    """Locate Inno Setup command-line compiler (ISCC.exe)."""
    # 1. In PATH
    iscc_path = shutil.which("iscc") or shutil.which("ISCC.exe")
    if iscc_path:
        return Path(iscc_path)

    # 2. Common Program Files locations
    candidates = [
        Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
        Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
        Path(r"C:\Program Files (x86)\Inno Setup 5\ISCC.exe"),
        Path(r"C:\Program Files\Inno Setup 5\ISCC.exe"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe"
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def run_pyinstaller() -> bool:
    """Run PyInstaller with pii_sentinel.spec."""
    spec_file = PACKAGING_DIR / "pii_sentinel.spec"
    print("=" * 60)
    print("STEP 1: Building Standalone Executable via PyInstaller...")
    print(f"Spec File: {spec_file}")
    print("=" * 60)

    # Ensure icon exists
    ico_file = PACKAGING_DIR / "assets" / "app_icon.ico"
    if not ico_file.exists():
        from packaging.create_assets import generate_app_icon
        generate_app_icon(PACKAGING_DIR / "assets")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        str(spec_file)
    ]

    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    if result.returncode != 0:
        print("[ERROR] PyInstaller compilation failed.")
        return False

    output_exe = DIST_DIR / "PIISentinel" / "PIISentinel.exe"
    if output_exe.exists():
        print(f"[SUCCESS] Standalone executable created at:\n  {output_exe}")
        return True
    else:
        print(f"[ERROR] Expected binary not found at {output_exe}")
        return False


def run_inno_setup() -> bool:
    """Compile Inno Setup installer script."""
    print("=" * 60)
    print("STEP 2: Packaging into Windows Installer (.exe)...")
    print("=" * 60)

    iscc_exe = find_iscc()
    iss_file = PACKAGING_DIR / "installer.iss"

    if not iscc_exe:
        print("[WARNING] Inno Setup compiler (ISCC.exe) not found on this system.")
        print("To produce the final single-click installer:")
        print("  1. Download and install Inno Setup 6 from: https://jrsoftware.org/isdl.php")
        print("  2. Open 'packaging/installer.iss' in Inno Setup Compiler and click 'Build > Compile',")
        print("     or run: iscc packaging/installer.iss")
        return False

    print(f"Found Inno Setup Compiler: {iscc_exe}")
    INSTALLER_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    cmd = [str(iscc_exe), str(iss_file)]
    result = subprocess.run(cmd, cwd=str(PACKAGING_DIR))

    if result.returncode == 0:
        installer_file = INSTALLER_OUTPUT_DIR / "PIISentinel_Setup_v1.0.exe"
        if installer_file.exists():
            print("=" * 60)
            print(f"[SUCCESS] Installer created successfully!")
            print(f"Deliverable: {installer_file}")
            print(f"Size: {installer_file.stat().st_size / (1024 * 1024):.1f} MB")
            print("=" * 60)
            return True
    print("[ERROR] Inno Setup compilation failed.")
    return False


def main():
    success_pyinstaller = run_pyinstaller()
    if not success_pyinstaller:
        sys.exit(1)

    run_inno_setup()


if __name__ == "__main__":
    main()
