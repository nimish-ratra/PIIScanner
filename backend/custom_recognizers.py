"""
Custom Microsoft Presidio Recognizers for India-Specific PII and Developer Secrets.
Implements native EntityRecognizer / PatternRecognizer classes with mathematical
validation (e.g. Verhoeff algorithm for Aadhaar) and context proximity boosts.
"""

from typing import List, Optional
from presidio_analyzer import PatternRecognizer, Pattern


# =====================================================================
# 1. VERHOEFF ALGORITHM IMPLEMENTATION (Aadhaar Checksum Validation)
# =====================================================================

VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
]

VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
]


def validate_verhoeff(number_str: str) -> bool:
    """Validate a number sequence using the Verhoeff checksum algorithm."""
    digits = [int(c) for c in number_str if c.isdigit()]
    if len(digits) != 12:
        return False
    c = 0
    for i, item in enumerate(reversed(digits)):
        c = VERHOEFF_D[c][VERHOEFF_P[i % 8][item]]
    return c == 0


# =====================================================================
# 2. INDIA-SPECIFIC PII RECOGNIZERS
# =====================================================================

class InAadhaarRecognizer(PatternRecognizer):
    """
    Recognizer for Indian Aadhaar Numbers (UIDAI).
    Validates candidates using the Verhoeff checksum algorithm to eliminate false positives.
    """

    PATTERNS = [
        Pattern(
            name="aadhaar_formatted",
            regex=r"\b[2-9]{1}[0-9]{3}[\s\-][0-9]{4}[\s\-][0-9]{4}\b",
            score=0.85
        ),
        Pattern(
            name="aadhaar_unformatted",
            regex=r"\b[2-9]{1}[0-9]{11}\b",
            score=0.40
        )
    ]

    CONTEXT = [
        "aadhaar", "aadhar", "uidai", "uid", "resident id",
        "identity number", "aadhaar card", "aadhar card"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="IN_AADHAAR",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="InAadhaarRecognizer"
        )

    def validate_result(self, pattern_text: str) -> Optional[bool]:
        """Verify the candidate strictly satisfies the Verhoeff checksum."""
        digits = "".join(c for c in pattern_text if c.isdigit())
        if len(digits) != 12:
            return False
        # Reject obvious sequential or repeating dummy test sequences
        if digits in ["000000000000", "111111111111", "123456789012"]:
            return False
        return validate_verhoeff(digits)


class InPanRecognizer(PatternRecognizer):
    """
    Recognizer for Indian Permanent Account Number (PAN Card).
    Structure: 5 uppercase letters + 4 digits + 1 uppercase letter.
    4th character designates the status of the entity (e.g. P = Person, C = Company).
    """

    PATTERNS = [
        Pattern(
            name="pan_strict",
            regex=r"\b[A-Z]{3}[CPHFATBLJG][A-Z]{1}[0-9]{4}[A-Z]{1}\b",
            score=0.85
        ),
        Pattern(
            name="pan_general",
            regex=r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b",
            score=0.40
        )
    ]

    CONTEXT = [
        "pan", "pan card", "income tax", "permanent account number",
        "nsdl", "utiitsl", "pan no", "pan#", "form 16", "itr"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="IN_PAN",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="InPanRecognizer"
        )


class InGstinRecognizer(PatternRecognizer):
    """
    Recognizer for Goods and Services Tax Identification Number (GSTIN).
    Structure: 2 digits (State Code) + 10 char PAN + 1 char entity + Z + 1 check digit.
    """

    PATTERNS = [
        Pattern(
            name="gstin_strict",
            regex=r"\b[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b",
            score=0.90
        )
    ]

    CONTEXT = [
        "gst", "gstin", "goods and services tax", "tax invoice",
        "gst number", "gst#", "supplier gstin", "buyer gstin"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="IN_GSTIN",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="InGstinRecognizer"
        )


class InIfscRecognizer(PatternRecognizer):
    """
    Recognizer for Indian Financial System Code (IFSC).
    Structure: 4 letters (Bank) + 0 + 6 alphanumeric branch code.
    """

    PATTERNS = [
        Pattern(
            name="ifsc_strict",
            regex=r"\b[A-Z]{4}0[A-Z0-9]{6}\b",
            score=0.75
        )
    ]

    CONTEXT = [
        "ifsc", "ifsc code", "rtgs", "neft", "imps",
        "bank branch", "branch code", "bank account", "beneficiary"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="IN_IFSC",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="InIfscRecognizer"
        )


class InPassportRecognizer(PatternRecognizer):
    """
    Recognizer for Indian Passport Numbers.
    Structure: 1 uppercase letter (excluding Q, X, Z) + 7 digits.
    """

    PATTERNS = [
        Pattern(
            name="in_passport",
            regex=r"\b[A-PR-WYZ][0-9]{7}\b",
            score=0.50
        )
    ]

    CONTEXT = [
        "passport", "passport no", "passport number", "republic of india",
        "indian passport", "mrz", "nationality indian", "place of issue"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="IN_PASSPORT",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="InPassportRecognizer"
        )


class InVoterIdRecognizer(PatternRecognizer):
    """
    Recognizer for Indian Voter ID Card (EPIC - Elector's Photo Identity Card).
    Structure: 3 letters + 7 digits.
    """

    PATTERNS = [
        Pattern(
            name="in_voter_id",
            regex=r"\b[A-Z]{3}[0-9]{7}\b",
            score=0.45
        )
    ]

    CONTEXT = [
        "voter", "epic", "voter id", "election commission",
        "electoral", "eci", "epic no", "elector", "constituency"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="IN_VOTER_ID",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="InVoterIdRecognizer"
        )


# =====================================================================
# 3. SECRETS, API KEYS & CREDENTIALS RECOGNIZERS
# =====================================================================

class AwsAccessKeyRecognizer(PatternRecognizer):
    """
    Recognizer for Amazon Web Services (AWS) Access Key IDs (AKIA, ASIA, AROA, AIPA).
    """

    PATTERNS = [
        Pattern(
            name="aws_access_key",
            regex=r"\b(AKIA|ASIA|AROA|AIPA)[0-9A-Z]{16}\b",
            score=0.95
        )
    ]

    CONTEXT = [
        "aws", "amazon", "access_key", "secret_key", "aws_access_key_id",
        "s3", "iam", "credential", "cloud"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="AWS_ACCESS_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="AwsAccessKeyRecognizer"
        )


class GitHubTokenRecognizer(PatternRecognizer):
    """
    Recognizer for GitHub Personal Access Tokens and Fine-Grained PATs.
    """

    PATTERNS = [
        Pattern(
            name="github_classic_token",
            regex=r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b",
            score=0.95
        ),
        Pattern(
            name="github_fine_grained_pat",
            regex=r"\bgithub_pat_[A-Za-z0-9_]{82}\b",
            score=0.98
        )
    ]

    CONTEXT = [
        "github", "token", "pat", "personal access token",
        "repo", "git", "bearer", "authorization"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="GITHUB_TOKEN",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="GitHubTokenRecognizer"
        )


class OpenAiKeyRecognizer(PatternRecognizer):
    """
    Recognizer for OpenAI API Keys (legacy sk- and modern sk-proj-).
    """

    PATTERNS = [
        Pattern(
            name="openai_api_key",
            regex=r"\bsk-(proj-)?[a-zA-Z0-9\-_]{20,100}\b",
            score=0.90
        )
    ]

    CONTEXT = [
        "openai", "api_key", "chatgpt", "gpt-4", "sk-",
        "bearer", "ai key", "organization"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="OPENAI_API_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="OpenAiKeyRecognizer"
        )


class GoogleApiKeyRecognizer(PatternRecognizer):
    """
    Recognizer for Google Cloud & Firebase API Keys.
    """

    PATTERNS = [
        Pattern(
            name="google_api_key",
            regex=r"\bAIza[0-9A-Za-z\-_]{35}\b",
            score=0.95
        )
    ]

    CONTEXT = [
        "google", "gcp", "api_key", "firebase", "cloud",
        "maps", "youtube", "client_secret"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="GOOGLE_API_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="GoogleApiKeyRecognizer"
        )


class SlackTokenRecognizer(PatternRecognizer):
    """
    Recognizer for Slack Bot/User Tokens and Incoming Webhooks.
    """

    PATTERNS = [
        Pattern(
            name="slack_token",
            regex=r"\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,32}\b",
            score=0.95
        ),
        Pattern(
            name="slack_webhook",
            regex=r"https://hooks\.slack\.com/services/T[0-9A-Z]{8,11}/B[0-9A-Z]{8,11}/[0-9A-Za-z]{24}",
            score=0.98
        )
    ]

    CONTEXT = [
        "slack", "bot_token", "webhook", "chat:write", "channel", "slack_api"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="SLACK_TOKEN",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="SlackTokenRecognizer"
        )


class PrivateKeyRecognizer(PatternRecognizer):
    """
    Recognizer for RSA, DSA, EC, SSH, and PGP Private Key Headers.
    """

    PATTERNS = [
        Pattern(
            name="private_key_header",
            regex=r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----",
            score=1.00
        )
    ]

    CONTEXT = [
        "key", "pem", "ssh", "ssl", "private", "certificate", "id_rsa"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="PRIVATE_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="PrivateKeyRecognizer"
        )


class JwtTokenRecognizer(PatternRecognizer):
    """
    Recognizer for JSON Web Tokens (JWT).
    Structure: Three base64url encoded parts separated by periods.
    """

    PATTERNS = [
        Pattern(
            name="jwt_token",
            regex=r"\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b",
            score=0.85
        )
    ]

    CONTEXT = [
        "jwt", "token", "bearer", "authorization", "auth", "access_token", "id_token"
    ]

    def __init__(self):
        super().__init__(
            supported_entity="JWT_TOKEN",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            name="JwtTokenRecognizer"
        )


# =====================================================================
# FACTORY / REGISTRATION FUNCTION
# =====================================================================

def get_custom_recognizers() -> List[PatternRecognizer]:
    """Instantiate and return all India-specific and Secret recognizers."""
    return [
        # India-Specific PII
        InAadhaarRecognizer(),
        InPanRecognizer(),
        InGstinRecognizer(),
        InIfscRecognizer(),
        InPassportRecognizer(),
        InVoterIdRecognizer(),

        # Secrets, Keys & Credentials
        AwsAccessKeyRecognizer(),
        GitHubTokenRecognizer(),
        OpenAiKeyRecognizer(),
        GoogleApiKeyRecognizer(),
        SlackTokenRecognizer(),
        PrivateKeyRecognizer(),
        JwtTokenRecognizer()
    ]
