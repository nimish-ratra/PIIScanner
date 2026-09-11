"""
Unit tests for backend.drive_scanner and multi-drive Scanner functionality.
Verifies fixed drive discovery, exclusion rules, and recursive tree pruning.
"""

import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock

from backend.drive_scanner import get_fixed_drives, is_path_excluded, DEFAULT_SYSTEM_EXCLUSIONS
from backend.scanner import Scanner


class TestDriveScanner(unittest.TestCase):

    def test_01_get_fixed_drives_returns_valid_drives(self):
        """Verify get_fixed_drives returns real mounted drives."""
        drives = get_fixed_drives()
        self.assertIsInstance(drives, list)
        self.assertGreaterEqual(len(drives), 1)
        for drive in drives:
            self.assertTrue(drive.endswith("\\"), f"Drive root must end with backslash: {drive}")
            self.assertTrue(os.path.exists(drive), f"Drive root must exist: {drive}")

    def test_02_get_fixed_drives_filters_removable_and_network(self):
        """Verify optical, network, and removable partitions are strictly excluded."""
        mock_p1 = MagicMock(device="C:", mountpoint="C:\\", fstype="NTFS", opts="rw,fixed")
        mock_p2 = MagicMock(device="D:", mountpoint="D:\\", fstype="CDFS", opts="ro,cdrom")
        mock_p3 = MagicMock(device="E:", mountpoint="E:\\", fstype="FAT32", opts="rw,removable")
        mock_p4 = MagicMock(device="Z:", mountpoint="Z:\\", fstype="SMB", opts="rw,network")

        with patch("psutil.disk_partitions", return_value=[mock_p1, mock_p2, mock_p3, mock_p4]):
            with patch("win32file.GetDriveType", side_effect=lambda mp: 3 if "C" in mp else 2):
                with patch("os.path.exists", return_value=True):
                    drives = get_fixed_drives()
                    self.assertIn("C:\\", drives)
                    self.assertNotIn("D:\\", drives)
                    self.assertNotIn("E:\\", drives)
                    self.assertNotIn("Z:\\", drives)

    def test_03_is_path_excluded_system_paths(self):
        """Verify default system exclusions properly match noise/system directories."""
        self.assertTrue(is_path_excluded(r"C:\Windows\System32\kernel32.dll"))
        self.assertTrue(is_path_excluded(r"c:\windows\notepad.exe"))
        self.assertTrue(is_path_excluded(r"C:\Program Files\Office\word.exe"))
        self.assertTrue(is_path_excluded(r"C:\Program Files (x86)\App\app.exe"))
        self.assertTrue(is_path_excluded(r"C:\$Recycle.Bin\S-1-5-21\deleted.docx"))
        self.assertTrue(is_path_excluded(r"C:\ProgramData\Package Cache\installer.msi"))
        self.assertTrue(is_path_excluded(r"C:\Users\Admin\AppData\Local\Temp\temp_file.txt"))
        self.assertTrue(is_path_excluded(r"D:\WebDev\project\node_modules\express\index.js"))
        self.assertTrue(is_path_excluded(r"D:\GitRepos\repo\.git\HEAD"))

    def test_04_is_path_not_excluded_for_user_documents(self):
        """Verify genuine user document paths are never falsely excluded."""
        self.assertFalse(is_path_excluded(r"C:\Users\Nimish\Documents\financial_audit.xlsx"))
        self.assertFalse(is_path_excluded(r"C:\Users\Nimish\Desktop\aadhar_card.pdf"))
        self.assertFalse(is_path_excluded(r"D:\CompanyData\Confidential\contracts.docx"))
        self.assertFalse(is_path_excluded(r"E:\Archive2026\employees.csv"))

    def test_05_scanner_multi_folder_and_exclusion_pruning(self):
        """Verify Scanner iterates across multiple root paths and skips excluded subtrees."""
        with tempfile.TemporaryDirectory() as root_tmp:
            dir_a = os.path.join(root_tmp, "FolderA")
            dir_b = os.path.join(root_tmp, "FolderB")
            os.makedirs(dir_a, exist_ok=True)
            os.makedirs(dir_b, exist_ok=True)

            # Legitimate test documents
            doc1 = os.path.join(dir_a, "doc1.txt")
            doc2 = os.path.join(dir_b, "doc2.txt")
            with open(doc1, "w", encoding="utf-8") as f:
                f.write("Normal doc 1")
            with open(doc2, "w", encoding="utf-8") as f:
                f.write("Normal doc 2")

            # Excluded directory inside FolderA
            git_dir = os.path.join(dir_a, ".git")
            os.makedirs(git_dir, exist_ok=True)
            git_file = os.path.join(git_dir, "config.txt")
            with open(git_file, "w", encoding="utf-8") as f:
                f.write("Git config")

            scanner = Scanner(
                target_folder=[dir_a, dir_b],
                supported_extensions=[".txt"],
                scan_source="full_system_scan",
                exclusion_patterns=[".git"]
            )

            eligible = scanner._count_eligible_files()
            self.assertEqual(len(eligible), 2)
            self.assertIn(os.path.abspath(doc1), [os.path.abspath(p) for p in eligible])
            self.assertIn(os.path.abspath(doc2), [os.path.abspath(p) for p in eligible])
            self.assertNotIn(os.path.abspath(git_file), [os.path.abspath(p) for p in eligible])


if __name__ == "__main__":
    unittest.main()
