"""
Headless Classification CLI for clAIssify / O365 Cloud Connector
Permits central services (such as apps/cloud-connector) to classify file streams
using the exact same Presidio + Tika + Purview Classifier engine without duplicating
detection logic in TypeScript.
Usage:
  python -m backend.classifier_cli --file /path/to/file.docx
  python -m backend.classifier_cli --json-stdin < payload.json
"""

import sys
import os
import json
import argparse
import tempfile
import base64
from pathlib import Path

# Ensure agent directory is in path
AGENT_DIR = Path(__file__).parent.parent.resolve()
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from backend.tika_extractor import TikaExtractor
from backend.presidio_detector import PresidioDetector, redact_value
from backend.classifier import classify_document, SensitivityTier


def classify_file_on_disk(file_path: str, filename_hint: str = None) -> dict:
    tika = TikaExtractor()
    detector = PresidioDetector()

    path_obj = Path(file_path)
    if not path_obj.exists():
        return {
            "error": f"File not found: {file_path}",
            "tier": SensitivityTier.PUBLIC.value,
            "level": 1,
            "findings": [],
            "total_findings": 0,
            "entity_counts": {}
        }

    raw_text, err = tika.extract_text(str(path_obj))
    if not raw_text or not raw_text.strip():
        # Fallback to direct reading if text/plain
        try:
            with open(path_obj, "r", encoding="utf-8", errors="ignore") as f:
                raw_text = f.read(1024 * 1024)
        except Exception:
            raw_text = ""

    if not raw_text:
        return {
            "tier": SensitivityTier.PUBLIC.value,
            "level": 1,
            "badge": "🟢 Public",
            "findings": [],
            "total_findings": 0,
            "entity_counts": {},
            "file_path": filename_hint or path_obj.name
        }

    findings = detector.analyze_text(raw_text)
    classification = classify_document(findings)

    # Format findings and entity counts
    entity_counts = {}
    finding_items = []
    for f in findings:
        ent = f.get("entity", "UNKNOWN")
        entity_counts[ent] = entity_counts.get(ent, 0) + 1
        finding_items.append({
            "entity_type": ent,
            "redacted_value": f.get("value_redacted", "**"),
            "confidence": round(f.get("confidence", 0.0), 3),
            "start": f.get("start", 0),
            "end": f.get("end", 0)
        })

    return {
        "tier": classification.get("tier", "Public"),
        "level": classification.get("level", 1),
        "badge": classification.get("badge", "🟢 Public"),
        "recommended_action": classification.get("recommended_action", "Allow"),
        "rationale": classification.get("rationale") or classification.get("description", ""),
        "total_findings": len(finding_items),
        "findings": finding_items,
        "entity_counts": entity_counts,
        "file_path": filename_hint or path_obj.name
    }


def main():
    parser = argparse.ArgumentParser(description="clAIssify Headless Classifier CLI")
    parser.add_argument("--file", help="Path to file to inspect")
    parser.add_argument("--filename", help="Original filename hint for mime-type detection")
    parser.add_argument("--base64", help="Base64 encoded file payload")
    parser.add_argument("--json-stdin", action="store_true", help="Read JSON {filename, content_base64} from stdin")

    args = parser.parse_args()

    if args.json_stdin:
        input_data = sys.stdin.read()
        parsed = json.loads(input_data)
        filename = parsed.get("filename", "document.bin")
        content_b64 = parsed.get("content_base64", "")
        raw_bytes = base64.b64decode(content_b64)

        suffix = Path(filename).suffix or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw_bytes)
            tmp_path = tmp.name

        try:
            res = classify_file_on_disk(tmp_path, filename_hint=filename)
            print(json.dumps(res))
        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        return

    if args.base64:
        raw_bytes = base64.b64decode(args.base64)
        filename = args.filename or "document.bin"
        suffix = Path(filename).suffix or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw_bytes)
            tmp_path = tmp.name

        try:
            res = classify_file_on_disk(tmp_path, filename_hint=filename)
            print(json.dumps(res))
        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        return

    if args.file:
        res = classify_file_on_disk(args.file, filename_hint=args.filename)
        print(json.dumps(res))
        return

    print(json.dumps({"error": "No input provided. Use --file, --base64, or --json-stdin."}))


if __name__ == "__main__":
    main()
