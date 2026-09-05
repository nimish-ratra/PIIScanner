"""
Report Generator for PII Sentinel
Generates report.csv, report.json, and interactive modern HTML dashboard.
"""

import os
import csv
import json
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


def write_csv(findings: List[Dict[str, Any]], filepath: str) -> bool:
    """Write findings to a CSV file."""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            fieldnames = [
                "file", "entity", "value_redacted", "confidence",
                "start", "end", "file_size_bytes", "last_modified"
            ]
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in findings:
                # Ensure value_redacted is used for privacy
                row_copy = dict(row)
                if "value_redacted" not in row_copy and "value" in row_copy:
                    row_copy["value_redacted"] = row_copy["value"]
                writer.writerow(row_copy)
        logger.info(f"CSV report written to: {filepath}")
        return True
    except Exception as e:
        logger.error(f"Failed to write CSV report to {filepath}: {e}")
        return False


def write_json(
    findings: List[Dict[str, Any]],
    filepath: str,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """Write findings and scan metadata to a JSON file."""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        data = {
            "metadata": metadata or {},
            "generated_at": datetime.now().isoformat(),
            "total_findings": len(findings),
            "findings": findings
        }
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        logger.info(f"JSON report written to: {filepath}")
        return True
    except Exception as e:
        logger.error(f"Failed to write JSON report to {filepath}: {e}")
        return False


def write_html_dashboard(
    findings: List[Dict[str, Any]],
    files_scanned: int,
    files_with_pii: int,
    filepath: str,
    scan_metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Generate an interactive, responsive HTML dashboard report.
    Reuses and elevates the user's reference dashboard with modern CSS cards,
    entity breakdown badges, responsive design, and search/filter JS.
    """
    try:
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        metadata = scan_metadata or {}
        scan_folder = metadata.get("target_folder", "Unknown")
        scan_duration = metadata.get("duration_seconds", 0.0)
        confidence_thresh = metadata.get("confidence_threshold", 0.6)
        gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Entity count aggregation
        entity_counts: Dict[str, int] = {}
        file_risk: Dict[str, int] = {}
        for item in findings:
            ent = item.get("entity", "UNKNOWN")
            fl = item.get("file", "Unknown")
            entity_counts[ent] = entity_counts.get(ent, 0) + 1
            file_risk[fl] = file_risk.get(fl, 0) + 1

        top_files = sorted(file_risk.items(), key=lambda x: x[1], reverse=True)[:10]

        # Entity table rows with percentage bar
        total_f = len(findings) if findings else 1
        entity_rows = "".join(
            f"""<tr>
                <td><span class="badge badge-entity">{entity}</span></td>
                <td><strong>{count}</strong></td>
                <td>
                    <div class="progress-track">
                        <div class="progress-fill" style="width: {min(100, int((count / total_f) * 100))}%;"></div>
                    </div>
                </td>
            </tr>"""
            for entity, count in sorted(entity_counts.items(), key=lambda x: -x[1])
        ) or "<tr><td colspan='3' class='empty'>No PII entities detected</td></tr>"

        # Top files rows
        file_rows = "".join(
            f"""<tr>
                <td class="filepath-cell" title="{file}">{file}</td>
                <td><span class="badge badge-risk">{count} matches</span></td>
            </tr>"""
            for file, count in top_files
        ) or "<tr><td colspan='2' class='empty'>No files with PII found</td></tr>"

        # Finding rows (up to 2000 in HTML to prevent browser bloat, with note if truncated)
        display_findings = findings[:2000]
        finding_rows = "".join(
            f"""<tr>
                <td class="filepath-cell" title="{item.get('file', '')}">{os.path.basename(item.get('file', ''))}</td>
                <td><span class="badge badge-entity">{item.get('entity', '')}</span></td>
                <td class="mono">{item.get('value_redacted', item.get('value', ''))}</td>
                <td><span class="confidence-pill" style="opacity: {max(0.4, item.get('confidence', 0.5))};">{item.get('confidence', 0):.2f}</span></td>
                <td class="filepath-sub">{item.get('file', '')}</td>
            </tr>"""
            for item in display_findings
        ) or "<tr><td colspan='5' class='empty'>No findings to display</td></tr>"

        truncation_note = ""
        if len(findings) > 2000:
            truncation_note = f"<p class='note'>Showing first 2,000 of {len(findings)} findings. See report.csv for full dataset.</p>"

        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PII Sentinel - Scan Dashboard</title>
<style>
  :root {{
    --bg: #0f172a;
    --card-bg: #1e293b;
    --card-border: #334155;
    --text: #f8fafc;
    --text-muted: #94a3b8;
    --accent: #3b82f6;
    --accent-hover: #2563eb;
    --danger: #ef4444;
    --danger-bg: rgba(239, 68, 68, 0.15);
    --warning: #f59e0b;
    --success: #10b981;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 30px;
    line-height: 1.5;
  }}
  .container {{ max-width: 1300px; margin: 0 auto; }}
  header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--card-border);
    padding-bottom: 20px;
    margin-bottom: 30px;
  }}
  .logo-area h1 {{
    font-size: 28px;
    font-weight: 700;
    color: #60a5fa;
    display: flex;
    align-items: center;
    gap: 10px;
  }}
  .subtitle {{ color: var(--text-muted); font-size: 14px; margin-top: 4px; }}
  .header-actions {{ display: flex; gap: 12px; }}
  a.button {{
    display: inline-flex;
    align-items: center;
    padding: 10px 18px;
    background: var(--accent);
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    transition: background 0.2s;
  }}
  a.button:hover {{ background: var(--accent-hover); }}

  /* Metric Cards */
  .metrics-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
  }}
  .card {{
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 22px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
  }}
  .card-label {{
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  .card-value {{
    font-size: 34px;
    font-weight: 700;
    margin-top: 8px;
    color: var(--text);
  }}
  .card-danger .card-value {{ color: #f87171; }}
  .card-warning .card-value {{ color: #fbbf24; }}
  .card-info .card-value {{ color: #60a5fa; }}

  /* Panels Grid */
  .panels-grid {{
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: 24px;
    margin-bottom: 30px;
  }}
  @media (max-width: 900px) {{
    .panels-grid {{ grid-template-columns: 1fr; }}
  }}
  .panel-title {{
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}

  /* Tables */
  table {{
    width: 100%;
    border-collapse: collapse;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 8px;
    overflow: hidden;
  }}
  th, td {{
    padding: 12px 16px;
    text-align: left;
    font-size: 14px;
    border-bottom: 1px solid var(--card-border);
  }}
  th {{
    background: #182234;
    color: var(--text-muted);
    font-weight: 600;
    text-transform: uppercase;
    font-size: 12px;
    letter-spacing: 0.5px;
  }}
  tr:last-child td {{ border-bottom: none; }}
  tr:hover td {{ background: rgba(255, 255, 255, 0.02); }}
  .filepath-cell {{
    max-width: 320px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: monospace;
    font-size: 13px;
  }}
  .filepath-sub {{
    color: var(--text-muted);
    font-size: 12px;
    max-width: 400px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: monospace;
  }}
  .mono {{
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 13px;
    color: #e2e8f0;
    background: #0f172a;
    padding: 3px 6px;
    border-radius: 4px;
  }}
  .badge {{
    display: inline-block;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }}
  .badge-entity {{
    background: rgba(96, 165, 250, 0.15);
    color: #93c5fd;
    border: 1px solid rgba(96, 165, 250, 0.3);
  }}
  .badge-risk {{
    background: var(--danger-bg);
    color: #fca5a5;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }}
  .confidence-pill {{
    display: inline-block;
    padding: 2px 6px;
    background: #10b981;
    color: white;
    font-weight: bold;
    font-size: 12px;
    border-radius: 4px;
  }}
  .progress-track {{
    background: #334155;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    width: 100%;
  }}
  .progress-fill {{
    background: #3b82f6;
    height: 100%;
    border-radius: 4px;
  }}
  .empty {{ text-align: center; color: var(--text-muted); padding: 24px; }}
  .note {{ font-size: 13px; color: var(--text-muted); margin-top: 8px; }}
  .search-box {{
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid var(--card-border);
    background: #0f172a;
    color: white;
    font-size: 14px;
    width: 250px;
  }}
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo-area">
      <h1>&#128737; PII Sentinel Dashboard</h1>
      <p class="subtitle">Target: <strong>{scan_folder}</strong> &bull; Generated: {gen_time} &bull; Confidence &ge; {confidence_thresh}</p>
    </div>
    <div class="header-actions">
      <a class="button" href="report.csv" download>Download CSV</a>
      <a class="button" href="report.json" download style="background: #475569;">Download JSON</a>
    </div>
  </header>

  <div class="metrics-grid">
    <div class="card card-info">
      <div class="card-label">Files Scanned</div>
      <div class="card-value">{files_scanned}</div>
    </div>
    <div class="card card-warning">
      <div class="card-label">Files with PII</div>
      <div class="card-value">{files_with_pii}</div>
    </div>
    <div class="card card-danger">
      <div class="card-label">Total PII Findings</div>
      <div class="card-value">{len(findings)}</div>
    </div>
    <div class="card">
      <div class="card-label">Scan Duration</div>
      <div class="card-value" style="font-size: 26px;">{scan_duration:.1f}s</div>
    </div>
  </div>

  <div class="panels-grid">
    <div class="panel">
      <div class="panel-title">PII by Category</div>
      <table>
        <thead>
          <tr>
            <th>Entity Type</th>
            <th>Count</th>
            <th style="width: 40%;">Distribution</th>
          </tr>
        </thead>
        <tbody>
          {entity_rows}
        </tbody>
      </table>
    </div>

    <div class="panel">
      <div class="panel-title">Top Risky Files</div>
      <table>
        <thead>
          <tr>
            <th>File Path</th>
            <th>Findings</th>
          </tr>
        </thead>
        <tbody>
          {file_rows}
        </tbody>
      </table>
    </div>
  </div>

  <div class="panel" style="margin-bottom: 40px;">
    <div class="panel-title">
      <span>All Findings ({len(findings)})</span>
      <input type="text" id="findingsFilter" class="search-box" placeholder="Filter findings..." onkeyup="filterFindings()">
    </div>
    <table id="findingsTable">
      <thead>
        <tr>
          <th>File</th>
          <th>Entity</th>
          <th>Redacted Value</th>
          <th>Confidence</th>
          <th>Full Path</th>
        </tr>
      </thead>
      <tbody>
        {finding_rows}
      </tbody>
    </table>
    {truncation_note}
  </div>
</div>

<script>
function filterFindings() {{
  var input = document.getElementById("findingsFilter");
  var filter = input.value.toLowerCase();
  var table = document.getElementById("findingsTable");
  var tr = table.getElementsByTagName("tr");
  for (var i = 1; i < tr.length; i++) {{
    var text = tr[i].textContent || tr[i].innerText;
    if (text.toLowerCase().indexOf(filter) > -1) {{
      tr[i].style.display = "";
    }} else {{
      tr[i].style.display = "none";
    }}
  }}
}}
</script>
</body>
</html>
"""
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(html_content)
        logger.info(f"HTML dashboard report written to: {filepath}")
        return True
    except Exception as e:
        logger.error(f"Failed to write HTML dashboard to {filepath}: {e}")
        return False
