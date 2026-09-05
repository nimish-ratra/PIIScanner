"""
Microsoft Purview 5-Tier Information Protection Classifier for PII Sentinel
Maps Presidio detected entities, volume counts, and confidence levels into
enterprise sensitivity tiers aligned with Microsoft Purview / M365 Information Protection.
"""

from typing import List, Dict, Any, Optional
from enum import Enum


class SensitivityTier(str, Enum):
    PUBLIC = "Public"
    GENERAL = "General"
    CONFIDENTIAL = "Confidential"
    HIGHLY_CONFIDENTIAL = "Highly Confidential"
    RESTRICTED = "Restricted"


# Metadata, styling tokens, and descriptions for each Microsoft Purview tier
TIER_METADATA = {
    SensitivityTier.RESTRICTED.value: {
        "tier": SensitivityTier.RESTRICTED.value,
        "level": 5,
        "badge": "🟣 Restricted",
        "color": "#a855f7",
        "bg_color": "rgba(168, 85, 247, 0.15)",
        "border_color": "rgba(168, 85, 247, 0.35)",
        "html_class": "badge-restricted",
        "description": "Maximum enterprise risk. Developer credentials, private keys, or massive bulk records (>=50).",
        "recommended_action": "Strictly restricted access. Revoke exposed credentials immediately and isolate file."
    },
    SensitivityTier.HIGHLY_CONFIDENTIAL.value: {
        "tier": SensitivityTier.HIGHLY_CONFIDENTIAL.value,
        "level": 4,
        "badge": "🔴 Highly Confidential",
        "color": "#ef4444",
        "bg_color": "rgba(239, 68, 68, 0.15)",
        "border_color": "rgba(239, 68, 68, 0.35)",
        "html_class": "badge-highly-confidential",
        "description": "Critical national government IDs, financial/cardholder data, or bulk PII records (>=10).",
        "recommended_action": "Apply encryption (RMS), enforce access control list, and quarantine if unauthorized."
    },
    SensitivityTier.CONFIDENTIAL.value: {
        "tier": SensitivityTier.CONFIDENTIAL.value,
        "level": 3,
        "badge": "🟠 Confidential",
        "color": "#f59e0b",
        "bg_color": "rgba(245, 158, 11, 0.15)",
        "border_color": "rgba(245, 158, 11, 0.35)",
        "html_class": "badge-confidential",
        "description": "Standard personal contact information (1-9 instances) or internal business operational data.",
        "recommended_action": "Internal distribution only. Restrict external sharing and adhere to data retention."
    },
    SensitivityTier.GENERAL.value: {
        "tier": SensitivityTier.GENERAL.value,
        "level": 2,
        "badge": "⚪ General",
        "color": "#94a3b8",
        "bg_color": "rgba(148, 163, 184, 0.15)",
        "border_color": "rgba(148, 163, 184, 0.35)",
        "html_class": "badge-general",
        "description": "Daily internal business collaboration with 0 sensitive PII detected.",
        "recommended_action": "Standard enterprise access. No special encryption or masking required."
    },
    SensitivityTier.PUBLIC.value: {
        "tier": SensitivityTier.PUBLIC.value,
        "level": 1,
        "badge": "🟢 Public",
        "color": "#22c55e",
        "bg_color": "rgba(34, 197, 94, 0.15)",
        "border_color": "rgba(34, 197, 94, 0.35)",
        "html_class": "badge-public",
        "description": "Unrestricted content approved for external public consumption with 0 PII.",
        "recommended_action": "Safe for public distribution and external sharing."
    }
}

# Grouping definitions
SECRETS_ENTITIES = {
    "AWS_ACCESS_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY", "GOOGLE_API_KEY",
    "SLACK_TOKEN", "PRIVATE_KEY", "JWT_TOKEN"
}

GOVERNMENT_AND_FINANCIAL_ENTITIES = {
    # India Identifiers
    "IN_AADHAAR", "IN_PAN", "IN_GSTIN", "IN_IFSC", "IN_PASSPORT", "IN_VOTER_ID",
    # Financial Data (PCI-DSS)
    "CREDIT_CARD", "CRYPTO", "IBAN_CODE", "US_BANK_NUMBER",
    # Global Government IDs
    "US_SSN", "US_PASSPORT", "US_DRIVER_LICENSE", "US_ITIN", "UK_NHS",
    "ES_NIF", "IT_FISCAL_CODE", "IT_DRIVER_LICENSE", "IT_PASSPORT", "MEDICAL_LICENSE"
}

CONTACT_ENTITIES = {
    "PERSON", "EMAIL_ADDRESS", "EMAIL", "PHONE_NUMBER", "LOCATION",
    "DATE_TIME", "AGE", "IP_ADDRESS", "MAC_ADDRESS", "URL", "NRP", "ORGANIZATION", "ID"
}


def get_tier_metadata(tier_name: str) -> Dict[str, Any]:
    """Return styling metadata and badge for a given sensitivity tier."""
    return TIER_METADATA.get(tier_name, TIER_METADATA[SensitivityTier.GENERAL.value])


def classify_finding(finding: Any) -> Dict[str, Any]:
    """
    Classify an individual finding based on entity risk level.
    Accepts either a finding dictionary with an 'entity' key or a string entity name.
    Returns dictionary with classification tier, badge, color, level, and rationale.
    """
    if isinstance(finding, str):
        entity = finding.strip().upper()
    elif isinstance(finding, dict):
        entity = str(finding.get("entity", "")).strip().upper()
    else:
        entity = str(getattr(finding, "entity", "")).strip().upper()

    if entity in SECRETS_ENTITIES:
        tier = SensitivityTier.RESTRICTED.value
        rationale = f"High-risk credential/developer secret ({entity}) detected."
    elif entity in GOVERNMENT_AND_FINANCIAL_ENTITIES:
        tier = SensitivityTier.HIGHLY_CONFIDENTIAL.value
        rationale = f"Government or financial identifier ({entity}) detected."
    elif entity in CONTACT_ENTITIES:
        tier = SensitivityTier.CONFIDENTIAL.value
        rationale = f"Personal contact identifier ({entity}) detected."
    elif entity in ("", "NONE", "UNKNOWN", "UNKNOWN_CUSTOM"):
        tier = SensitivityTier.GENERAL.value
        rationale = "No recognized sensitive identifier detected."
    else:
        tier = SensitivityTier.CONFIDENTIAL.value
        rationale = f"Sensitive identifier ({entity}) detected."

    meta = get_tier_metadata(tier)
    return {
        "tier": tier,
        "badge": meta["badge"],
        "color": meta["color"],
        "level": meta["level"],
        "rationale": rationale
    }


def classify_document(findings: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Classify an entire document/file into Microsoft Purview's 5 sensitivity tiers
    based on entity criticality, volume (instance count), and confidence levels.

    Returns:
        Dict containing:
          - 'tier': SensitivityTier string
          - 'level': integer (1 to 5)
          - 'badge': visual badge string (e.g. '🔴 Highly Confidential')
          - 'color': hex color code
          - 'bg_color': CSS background rgba
          - 'rationale': detailed explanation for the classification
          - 'secrets_count': number of developer secrets
          - 'critical_count': number of national/financial IDs
          - 'contact_count': number of contact PII
          - 'total_count': total findings in this document
    """
    if not findings or len(findings) == 0:
        meta = get_tier_metadata(SensitivityTier.GENERAL.value)
        return {
            "tier": SensitivityTier.GENERAL.value,
            "level": meta["level"],
            "badge": meta["badge"],
            "color": meta["color"],
            "bg_color": meta["bg_color"],
            "border_color": meta["border_color"],
            "rationale": "No sensitive PII detected. Standard internal business document.",
            "secrets_count": 0,
            "critical_count": 0,
            "contact_count": 0,
            "total_count": 0
        }

    secrets_findings = [f for f in findings if str(f.get("entity", "")).upper() in SECRETS_ENTITIES]
    critical_findings = [f for f in findings if str(f.get("entity", "")).upper() in GOVERNMENT_AND_FINANCIAL_ENTITIES]
    contact_findings = [f for f in findings if str(f.get("entity", "")).upper() in CONTACT_ENTITIES]
    total_count = len(findings)

    # Rule 1: Developer Secrets / API Keys OR Extreme Bulk (>= 50 items) -> RESTRICTED (Level 5)
    if len(secrets_findings) > 0:
        secret_names = sorted(list({f.get("entity") for f in secrets_findings}))
        meta = get_tier_metadata(SensitivityTier.RESTRICTED.value)
        return {
            "tier": SensitivityTier.RESTRICTED.value,
            "level": meta["level"],
            "badge": meta["badge"],
            "color": meta["color"],
            "bg_color": meta["bg_color"],
            "border_color": meta["border_color"],
            "rationale": f"Contains {len(secrets_findings)} critical secret(s) [{', '.join(secret_names)}].",
            "secrets_count": len(secrets_findings),
            "critical_count": len(critical_findings),
            "contact_count": len(contact_findings),
            "total_count": total_count
        }

    if total_count >= 50:
        meta = get_tier_metadata(SensitivityTier.RESTRICTED.value)
        return {
            "tier": SensitivityTier.RESTRICTED.value,
            "level": meta["level"],
            "badge": meta["badge"],
            "color": meta["color"],
            "bg_color": meta["bg_color"],
            "border_color": meta["border_color"],
            "rationale": f"Massive PII exposure: contains {total_count} records (>=50 volume threshold).",
            "secrets_count": len(secrets_findings),
            "critical_count": len(critical_findings),
            "contact_count": len(contact_findings),
            "total_count": total_count
        }

    # Rule 2: Government IDs, Financial/Banking data OR Bulk Records (>= 10 items) -> HIGHLY CONFIDENTIAL (Level 4)
    if len(critical_findings) > 0:
        crit_names = sorted(list({f.get("entity") for f in critical_findings}))
        meta = get_tier_metadata(SensitivityTier.HIGHLY_CONFIDENTIAL.value)
        return {
            "tier": SensitivityTier.HIGHLY_CONFIDENTIAL.value,
            "level": meta["level"],
            "badge": meta["badge"],
            "color": meta["color"],
            "bg_color": meta["bg_color"],
            "border_color": meta["border_color"],
            "rationale": f"Contains {len(critical_findings)} high-risk government/financial identifier(s) [{', '.join(crit_names)}].",
            "secrets_count": len(secrets_findings),
            "critical_count": len(critical_findings),
            "contact_count": len(contact_findings),
            "total_count": total_count
        }

    if total_count >= 10:
        meta = get_tier_metadata(SensitivityTier.HIGHLY_CONFIDENTIAL.value)
        return {
            "tier": SensitivityTier.HIGHLY_CONFIDENTIAL.value,
            "level": meta["level"],
            "badge": meta["badge"],
            "color": meta["color"],
            "bg_color": meta["bg_color"],
            "border_color": meta["border_color"],
            "rationale": f"Bulk personal data: contains {total_count} PII identifiers (>=10 volume threshold).",
            "secrets_count": len(secrets_findings),
            "critical_count": len(critical_findings),
            "contact_count": len(contact_findings),
            "total_count": total_count
        }

    # Rule 3: Standard Personal Contact Information (1 to 9 items) -> CONFIDENTIAL (Level 3)
    meta = get_tier_metadata(SensitivityTier.CONFIDENTIAL.value)
    return {
        "tier": SensitivityTier.CONFIDENTIAL.value,
        "level": meta["level"],
        "badge": meta["badge"],
        "color": meta["color"],
        "bg_color": meta["bg_color"],
        "border_color": meta["border_color"],
        "rationale": f"Contains {total_count} standard personal contact identifier(s).",
        "secrets_count": len(secrets_findings),
        "critical_count": len(critical_findings),
        "contact_count": len(contact_findings),
        "total_count": total_count
    }
