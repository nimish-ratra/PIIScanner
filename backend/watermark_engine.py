"""
Format-Aware Watermarking Engine
Applies visible watermarks (.docx, .xlsx, .pptx, .pdf, images) or
non-destructive NTFS ADS metadata tags (.csv, .txt, .json, .xml, etc.)
with SHA-256 idempotency protection and pre-mutation backups.
"""

import os
import io
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional, Dict, Any, Union, Tuple

from backend.config import ConfigManager, get_watermark_backup_dir
from backend.database import DatabaseManager, db_manager
from backend.watermark_backup import compute_file_sha256, create_watermark_backup

logger = logging.getLogger(__name__)

# Tier hierarchy for threshold comparison
TIER_LEVELS = {
    "PUBLIC": 1,
    "GENERAL": 2,
    "CONFIDENTIAL": 3,
    "HIGHLY CONFIDENTIAL": 4,
    "RESTRICTED": 5
}


class WatermarkStatus(str, Enum):
    APPLIED = "applied"
    SKIPPED_ALREADY_WATERMARKED = "skipped_already_watermarked"
    SKIPPED_BELOW_THRESHOLD = "skipped_below_threshold"
    SKIPPED_FILE_IN_USE = "skipped_file_in_use"
    FAILED = "failed"
    REVERTED = "reverted"
    PENDING = "pending"


def is_file_open_or_locked(path: Union[str, Path]) -> Tuple[bool, str]:
    """
    Check whether a target file is currently open in another application or locked.
    1. For Office formats (.docx, .xlsx, .pptx, etc.), checks for sibling lock file (~$<filename>).
    2. For any format, attempts exclusive read-write open on Windows.
    Returns (is_in_use, reason).
    """
    p = Path(path).resolve()

    # Check 1: Sibling Office lock file
    office_exts = {".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"}
    if p.suffix.lower() in office_exts:
        lock_file = p.parent / f"~${p.name}"
        if lock_file.exists():
            return True, f"Office lock file exists ({lock_file.name}) — file is currently open in Office"

    # Check 2: Try opening file for exclusive read/write access briefly
    try:
        fd = os.open(str(p), os.O_RDWR)
        os.close(fd)
    except PermissionError as pe:
        return True, f"Permission denied (file is locked or in use by another process: {pe})"
    except OSError as oe:
        # On Windows, error 32 is ERROR_SHARING_VIOLATION
        if getattr(oe, "winerror", None) == 32:
            return True, f"File sharing violation — currently open in another application: {oe}"
    except Exception:
        pass

    return False, ""


@dataclass
class WatermarkResult:
    file_path: str
    status: WatermarkStatus
    method: str
    tier: str
    content_hash: str
    backup_path: Optional[str] = None
    watermarked_hash: Optional[str] = None
    message: str = ""


class WatermarkStrategy(ABC):
    """Abstract base strategy for format-specific watermarking."""

    @property
    @abstractmethod
    def method_name(self) -> str:
        pass

    @abstractmethod
    def apply(self, file_path: str, tier: str, watermark_text: str) -> bool:
        """Apply watermark to target file. Return True on success."""
        pass


class DocxWatermarkStrategy(WatermarkStrategy):
    """
    Applies footer classification text and diagonal WordArt VML shape in header.
    """
    @property
    def method_name(self) -> str:
        return "docx_wordart_and_footer"

    def apply(self, file_path: str, tier: str, watermark_text: str) -> bool:
        import docx
        from docx.oxml import parse_xml

        doc = docx.Document(file_path)
        safe_text = watermark_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

        for section in doc.sections:
            # 1. Clear or set footer paragraph text
            footer = section.footer
            if footer.paragraphs:
                p_foot = footer.paragraphs[0]
            else:
                p_foot = footer.add_paragraph()
            p_foot.text = watermark_text

            # 2. Add diagonal WordArt VML shape in header
            header = section.header
            vml_xml = (
                '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
                '<w:r><w:rPr><w:noProof/></w:rPr><w:pict>'
                '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" path="m,l,21600,21600e">'
                '<v:path textpathok="t" o:connecttype="rect"/>'
                '<v:textpath on="t" fitshape="t"/>'
                '</v:shapetype>'
                '<v:shape id="PIISentinelWatermark" type="#_x0000_t136" '
                'style="position:absolute;margin-left:0;margin-top:0;width:420pt;height:100pt;'
                'rotation:315;z-index:-251654144;mso-position-horizontal:center;'
                'mso-position-horizontal-relative:margin;mso-position-vertical:center;'
                'mso-position-vertical-relative:margin" fillcolor="#b0b0b0" stroked="f">'
                '<v:fill opacity="0.35"/>'
                f'<v:textpath on="t" fitshape="t" style="font-family:Calibri;font-weight:bold" string="{safe_text}"/>'
                '</v:shape>'
                '</w:pict></w:r></w:p>'
            )
            try:
                elem = parse_xml(vml_xml)
                header._element.append(elem)
            except Exception as ex:
                logger.warning(f"Could not append VML WordArt shape to docx header: {ex}")
                # Fallback: simple header text
                if header.paragraphs:
                    header.paragraphs[0].text = f"[{safe_text}]"
                else:
                    header.add_paragraph(f"[{safe_text}]")

        doc.save(file_path)
        return True


class XlsxWatermarkStrategy(WatermarkStrategy):
    """
    Applies header and footer cell-based watermark banner across all worksheets.
    """
    @property
    def method_name(self) -> str:
        return "xlsx_header_footer_banner"

    def apply(self, file_path: str, tier: str, watermark_text: str) -> bool:
        import openpyxl

        wb = openpyxl.load_workbook(file_path)
        # Excel header/footer mini-language uses & for formatting codes (&B, &12, etc.)
        # Literal ampersands must be escaped as && to avoid corrupting formatting
        safe_wm_text = watermark_text.replace("&", "&&")
        safe_tier = tier.replace("&", "&&")
        banner = f"&B&12&K808080 {safe_wm_text}"

        for ws in wb.worksheets:
            # Set header and footer text
            ws.oddHeader.center.text = banner
            ws.evenHeader.center.text = banner
            ws.oddFooter.center.text = f"&10&K808080 Classified by PII Sentinel — Tier: {safe_tier}"
            ws.evenFooter.center.text = ws.oddFooter.center.text

        wb.save(file_path)
        return True


class PptxWatermarkStrategy(WatermarkStrategy):
    """
    Applies watermark textbox to slide masters and slides across the presentation.
    """
    @property
    def method_name(self) -> str:
        return "pptx_master_and_slide_overlay"

    def apply(self, file_path: str, tier: str, watermark_text: str) -> bool:
        import copy
        from pptx import Presentation
        from pptx.util import Inches, Pt
        from pptx.dml.color import RGBColor

        prs = Presentation(file_path)
        watermark_color = RGBColor(180, 180, 180)

        # Apply to slides
        watermark_element = None
        for slide in prs.slides:
            tx = slide.shapes.add_textbox(Inches(0.5), Inches(3.0), Inches(9.0), Inches(1.5))
            tf = tx.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.text = watermark_text
            p.font.bold = True
            p.font.size = Pt(24)
            p.font.color.rgb = watermark_color
            tx.rotation = 315
            if watermark_element is None:
                watermark_element = copy.deepcopy(tx.element)

        # Also append to slide masters for any future or uninstantiated slides
        if watermark_element is not None:
            for master in prs.slide_masters:
                try:
                    master_elem = copy.deepcopy(watermark_element)

                    # Gather existing shape IDs in master spTree to ensure unique ID
                    existing_ids = set()
                    for node in master.element.spTree.iter():
                        if node.tag.endswith("cNvPr"):
                            sid = node.get("id")
                            if sid and sid.isdigit():
                                existing_ids.add(int(sid))

                    # Compute non-colliding ID
                    new_id = max(max(existing_ids, default=0) + 1, 900001)
                    while new_id in existing_ids:
                        new_id += 1

                    # Re-assign id on master element's cNvPr
                    for node in master_elem.iter():
                        if node.tag.endswith("cNvPr"):
                            node.set("id", str(new_id))
                            node.set("name", f"Watermark Shape {new_id}")

                    master.element.spTree.append(master_elem)
                except Exception as ex:
                    logger.debug(f"Could not append watermark to master spTree: {ex}")

        prs.save(file_path)
        return True


class PdfWatermarkStrategy(WatermarkStrategy):
    """
    Generates a diagonal semi-transparent overlay page using ReportLab
    and merges it onto every page using pypdf.
    """
    @property
    def method_name(self) -> str:
        return "pdf_diagonal_overlay"

    def apply(self, file_path: str, tier: str, watermark_text: str) -> bool:
        from pypdf import PdfReader, PdfWriter
        from reportlab.pdfgen import canvas
        from reportlab.lib import colors

        reader = PdfReader(file_path)
        writer = PdfWriter()

        for page in reader.pages:
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)

            # Generate in-memory watermark overlay PDF page
            packet = io.BytesIO()
            can = canvas.Canvas(packet, pagesize=(width, height))
            can.saveState()
            can.translate(width / 2.0, height / 2.0)
            can.rotate(45)
            can.setFillColor(colors.HexColor("#7A7A7A"), alpha=0.25)
            can.setFont("Helvetica-Bold", 22)
            can.drawCentredString(0, 0, watermark_text)
            can.restoreState()
            can.save()
            packet.seek(0)

            overlay_pdf = PdfReader(packet)
            watermark_page = overlay_pdf.pages[0]

            # Attach page to writer first to avoid pypdf deprecation warnings, then merge
            page_in_writer = writer.add_page(page)
            page_in_writer.merge_page(watermark_page)

        # Write to temporary file, then replace original
        temp_out = file_path + ".wm_tmp"
        with open(temp_out, "wb") as f_out:
            writer.write(f_out)

        os.replace(temp_out, file_path)
        return True


class ImageWatermarkStrategy(WatermarkStrategy):
    """
    Applies a semi-transparent diagonal text overlay to image files using Pillow.
    """
    @property
    def method_name(self) -> str:
        return "image_alpha_overlay"

    def apply(self, file_path: str, tier: str, watermark_text: str) -> bool:
        from PIL import Image, ImageDraw, ImageFont

        with Image.open(file_path) as base_img:
            orig_format = base_img.format or "PNG"
            img_rgba = base_img.convert("RGBA")

            # Create transparent overlay layer for rotated watermark
            w, h = img_rgba.size
            txt_overlay = Image.new("RGBA", (w, h), (255, 255, 255, 0))
            draw = ImageDraw.Draw(txt_overlay)

            font_size = max(14, int(w / 35))
            try:
                font = ImageFont.truetype("arial.ttf", font_size)
            except Exception:
                font = ImageFont.load_default()

            # Measure text size
            bbox = draw.textbbox((0, 0), watermark_text, font=font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]

            # Create text mask to rotate
            text_img = Image.new("RGBA", (text_w + 40, text_h + 40), (0, 0, 0, 0))
            text_draw = ImageDraw.Draw(text_img)
            text_draw.text((20, 20), watermark_text, fill=(200, 200, 200, 110), font=font)

            # Rotate 45 degrees
            rotated_text = text_img.rotate(45, expand=True, resample=Image.BICUBIC)
            rw, rh = rotated_text.size

            # Paste in center
            pos_x = (w - rw) // 2
            pos_y = (h - rh) // 2
            txt_overlay.paste(rotated_text, (pos_x, pos_y), rotated_text)

            # Composite
            watermarked = Image.alpha_composite(img_rgba, txt_overlay)

            # Save back
            temp_out = file_path + ".wm_tmp"
            if orig_format.upper() in ("JPEG", "JPG"):
                watermarked.convert("RGB").save(temp_out, format="JPEG", quality=95)
            else:
                watermarked.save(temp_out, format=orig_format)

        os.replace(temp_out, file_path)
        return True


class PlaintextAdsWatermarkStrategy(WatermarkStrategy):
    """
    Structured / Plaintext files (.csv, .txt, .json, .xml, etc.):
    Does NOT mutate main content bytes. Tags via an NTFS Alternate Data Stream
    (file:pii-sentinel-classification) and sets Windows shell metadata property.
    """
    @property
    def method_name(self) -> str:
        return "ntfs_ads_and_shell_property"

    def apply(self, file_path: str, tier: str, watermark_text: str) -> bool:
        path = Path(file_path).resolve()
        
        # 1. Tag via NTFS Alternate Data Stream (Primary Mechanism)
        ads_path = f"{path}:pii-sentinel-classification"
        ads_payload = {
            "tier": tier,
            "applied_at": datetime.now().isoformat(),
            "applied_by": "PII Sentinel",
            "classification_notice": watermark_text,
            "version": "1.0"
        }
        try:
            with open(ads_path, "w", encoding="utf-8") as f_ads:
                f_ads.write(json.dumps(ads_payload, indent=2))
            logger.info(f"[OK] Wrote NTFS ADS classification tag to {path.name}")
        except Exception as e:
            logger.error(f"[ERROR] Could not write NTFS ADS stream to {path.name}: {e}")
            raise RuntimeError(f"NTFS ADS write failed — is this an NTFS volume? ({e})")

        # 2. Attempt Windows Shell property store (Comments / Keywords) as secondary Explorer metadata
        try:
            from win32com.propsys import propsys, pscon
            # GPS_READWRITE = 2
            store = propsys.SHGetPropertyStoreFromParsingName(
                str(path),
                None,
                2,
                propsys.IID_IPropertyStore
            )
            prop = propsys.PROPVARIANTType(watermark_text)
            store.SetValue(pscon.PKEY_Comment, prop)
            store.Commit()
            logger.info(f"[OK] Wrote Windows Shell comment property to {path.name}")
        except Exception as ex:
            # Non-fatal on filesystems or formats without Shell property handler support
            logger.debug(f"Optional Windows Shell property store note for {path.name}: {ex}")

        return True


class WatermarkEngine:
    """
    Central orchestration engine for format-aware watermarking, idempotency,
    and pre-mutation backup verification.
    """

    def __init__(
        self,
        min_tier: str = "Confidential",
        template: Optional[str] = None,
        backup_dir: Optional[Path] = None,
        db: Optional[DatabaseManager] = None
    ):
        self.min_tier = min_tier
        self.template = template or (
            "CONFIDENTIAL — Classified by PII Sentinel — {tier} — {date} — Do Not Distribute"
        )
        self.backup_dir = backup_dir or get_watermark_backup_dir()
        self.db = db or db_manager

        # Format dispatch table
        self.strategies: Dict[str, WatermarkStrategy] = {
            ".docx": DocxWatermarkStrategy(),
            ".doc": DocxWatermarkStrategy(),
            ".xlsx": XlsxWatermarkStrategy(),
            ".xls": XlsxWatermarkStrategy(),
            ".pptx": PptxWatermarkStrategy(),
            ".ppt": PptxWatermarkStrategy(),
            ".pdf": PdfWatermarkStrategy(),
            ".png": ImageWatermarkStrategy(),
            ".jpg": ImageWatermarkStrategy(),
            ".jpeg": ImageWatermarkStrategy(),
            ".tiff": ImageWatermarkStrategy(),
            ".tif": ImageWatermarkStrategy(),
            ".bmp": ImageWatermarkStrategy(),
            ".webp": ImageWatermarkStrategy(),
            # Plaintext / structured fallback
            ".csv": PlaintextAdsWatermarkStrategy(),
            ".tsv": PlaintextAdsWatermarkStrategy(),
            ".txt": PlaintextAdsWatermarkStrategy(),
            ".json": PlaintextAdsWatermarkStrategy(),
            ".xml": PlaintextAdsWatermarkStrategy(),
            ".log": PlaintextAdsWatermarkStrategy(),
            ".yaml": PlaintextAdsWatermarkStrategy(),
            ".yml": PlaintextAdsWatermarkStrategy(),
            ".sql": PlaintextAdsWatermarkStrategy(),
        }
        self.fallback_plaintext_strategy = PlaintextAdsWatermarkStrategy()

    def is_tier_eligible(self, tier: str) -> bool:
        """Check if file's sensitivity tier meets or exceeds min_tier threshold."""
        file_level = TIER_LEVELS.get(tier.upper(), 0)
        threshold_level = TIER_LEVELS.get(self.min_tier.upper(), 3)
        return file_level >= threshold_level

    def format_watermark_text(self, tier: str, filepath: str) -> str:
        """Render the watermark template string with active context."""
        date_str = datetime.now().strftime("%Y-%m-%d")
        time_str = datetime.now().strftime("%H:%M:%S")
        filename = Path(filepath).name

        return self.template.format(
            tier=tier,
            date=date_str,
            time=time_str,
            filename=filename
        )

    def get_strategy_for_file(self, filepath: Union[str, Path]) -> WatermarkStrategy:
        """Select appropriate strategy based on file extension."""
        suffix = Path(filepath).suffix.lower()
        return self.strategies.get(suffix, self.fallback_plaintext_strategy)

    def apply_watermark(
        self,
        filepath: Union[str, Path],
        tier: str = "Confidential",
        dry_run: bool = False
    ) -> WatermarkResult:
        """
        Apply format-aware watermark to target file with SHA-256 idempotency check
        and pre-mutation backup.
        """
        path = Path(filepath).resolve()
        file_str = str(path)

        if not path.exists() or not path.is_file():
            return WatermarkResult(
                file_path=file_str,
                status=WatermarkStatus.FAILED,
                method="unknown",
                tier=tier,
                content_hash="",
                message=f"File does not exist: {file_str}"
            )

        # 1. Sensitivity threshold check
        if not self.is_tier_eligible(tier):
            return WatermarkResult(
                file_path=file_str,
                status=WatermarkStatus.SKIPPED_BELOW_THRESHOLD,
                method="none",
                tier=tier,
                content_hash="",
                message=f"Tier '{tier}' is below threshold '{self.min_tier}'"
            )

        # 2. Compute SHA-256 content hash
        try:
            content_hash = compute_file_sha256(path)
        except Exception as e:
            return WatermarkResult(
                file_path=file_str,
                status=WatermarkStatus.FAILED,
                method="unknown",
                tier=tier,
                content_hash="",
                message=f"Could not compute file hash: {e}"
            )

        # 3. Idempotency check in classification registry
        record = self.db.get_watermark_record(file_str)
        if record and record.get("watermark_status") == "applied":
            if record.get("content_hash_sha256") == content_hash:
                logger.info(f"[OK] File {path.name} is already watermarked and unchanged. Skipping.")
                return WatermarkResult(
                    file_path=file_str,
                    status=WatermarkStatus.SKIPPED_ALREADY_WATERMARKED,
                    method=record.get("watermark_method", "unknown"),
                    tier=tier,
                    content_hash=content_hash,
                    backup_path=record.get("watermark_backup_path"),
                    message="Already watermarked; content hash unchanged."
                )

        # 4. Handle Dry-Run Mode (Fast & safe: no backup taken until user confirms mutation)
        if dry_run:
            return WatermarkResult(
                file_path=file_str,
                status=WatermarkStatus.PENDING,
                method=self.get_strategy_for_file(path).method_name,
                tier=tier,
                content_hash=content_hash,
                backup_path=None,
                message="Dry run: candidate verified and eligible."
            )

        # 5. Check if file is currently open or locked by another application
        is_in_use, in_use_reason = is_file_open_or_locked(path)
        if is_in_use:
            logger.warning(f"[SKIP] File {path.name} is in use: {in_use_reason}")
            return WatermarkResult(
                file_path=file_str,
                status=WatermarkStatus.SKIPPED_FILE_IN_USE,
                method=self.get_strategy_for_file(path).method_name,
                tier=tier,
                content_hash=content_hash,
                backup_path=None,
                message=f"File in use: {in_use_reason}. Close this file before watermarking."
            )

        # 6. Create pre-mutation byte-for-byte backup
        try:
            backup_hash, backup_path = create_watermark_backup(path, backup_dir=self.backup_dir)
        except Exception as e:
            logger.error(f"[ERROR] Pre-mutation backup failed for {path.name}: {e}")
            self.db.record_watermark_failed(file_str, error=f"Backup failed: {e}", content_hash=content_hash)
            return WatermarkResult(
                file_path=file_str,
                status=WatermarkStatus.FAILED,
                method="backup",
                tier=tier,
                content_hash=content_hash,
                message=f"Pre-mutation backup failed: {e}"
            )

        # 6. Apply format-specific watermarking strategy
        strategy = self.get_strategy_for_file(path)
        watermark_text = self.format_watermark_text(tier, file_str)

        try:
            strategy.apply(file_str, tier, watermark_text)
            watermarked_hash = compute_file_sha256(path)

            # Record success in classification registry & findings table
            self.db.record_watermark_applied(
                file_path=file_str,
                content_hash=content_hash,
                method=strategy.method_name,
                backup_path=backup_path,
                tier=tier
            )

            logger.info(f"[OK] Successfully watermarked {path.name} via {strategy.method_name}")
            return WatermarkResult(
                file_path=file_str,
                status=WatermarkStatus.APPLIED,
                method=strategy.method_name,
                tier=tier,
                content_hash=content_hash,
                backup_path=backup_path,
                watermarked_hash=watermarked_hash,
                message="Watermark successfully applied."
            )

        except Exception as e:
            logger.error(f"[ERROR] Failed to apply watermark to {path.name}: {e}")
            self.db.record_watermark_failed(file_str, error=str(e), content_hash=content_hash)
            return WatermarkResult(
                file_path=file_str,
                status=WatermarkStatus.FAILED,
                method=strategy.method_name,
                tier=tier,
                content_hash=content_hash,
                backup_path=backup_path,
                message=f"Watermark execution error: {e}"
            )
