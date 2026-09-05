# 🛡️ Microsoft Presidio PII Detection Engine: Technical Catalog & Reference

> **Document Version:** 1.0  
> **Target System:** PII Sentinel (Windows Desktop Security Scanner)  
> **Source Module:** [`backend/presidio_detector.py`](file:///c:/PIISentinalApp/backend/presidio_detector.py)  
> **Core Dependency:** `presidio-analyzer` (Microsoft) + `spaCy` (`en_core_web_sm`)  
> **Operation Mode:** 100% Offline, Air-Gapped, On-Premise CPU Execution  

---

## 1. Executive Summary

**PII Sentinel** leverages **Microsoft Presidio** as its primary Natural Language Processing (NLP) and pattern-matching detection engine. Presidio provides enterprise-grade, multi-layered Personally Identifiable Information (PII) identification without transmitting any data over the network.

### Key Operational Guarantees
- **Zero Cloud Communication:** No external APIs, SaaS endpoints, or cloud telemetry are invoked. All NER models and regex recognizers run directly in the local Python process.
- **Hybrid Detection:** Combines statistical machine learning (spaCy NER), deterministic pattern matching (regular expressions), mathematical checksum validations (Verhoeff for Aadhaar, Luhn algorithm, ISO 7064 Mod-97), and contextual word proximity boosts.
- **Dynamic Entity Discovery:** Supports **36 distinct PII and Secret entity types** out of the box, dynamically queried at runtime via `analyzer.get_supported_entities()`.
- **Large-Document Chunking:** Seamlessly inspects massive text streams (exceeding spaCy's 1,000,000 character limit) by sliding 150,000-character windows with a 500-character overlap to prevent entity splitting at boundaries.

---

## 2. Detection Architecture & Mechanics

```
                         [Extracted Document Text]
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  Large-Document Chunker       │
                    │  (150,000 chars + 500 overlap)│
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
       ┌────────────────────────┐      ┌────────────────────────┐
       │   Pattern Recognizers  │      │    spaCy NER Model     │
       │ (Regex + Checksums)    │      │   (en_core_web_sm)     │
       └────────────┬───────────┘      └────────────┬───────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Context Word Proximity Engine │
                    │ (Boosts score when keywords   │
                    │  like 'card', 'pan' are near) │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Confidence Threshold Filter   │
                    │ (Default: 0.60 / 60%)         │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Redacted Preview Generator    │
                    │ (e.g. 'al********om')         │
                    └───────────────────────────────┘
```

### 2.1. The 4 Layers of PII Verification
1. **Regex Pattern Matching:** High-speed initial candidate identification using optimized regular expressions.
2. **Mathematical Checksum Validation:** Algorithmic validation to eliminate false positives:
   - **Verhoeff Algorithm:** Mathematically validates 12-digit Indian Aadhaar numbers (`IN_AADHAAR`), discarding candidates that fail the check digit.
   - **Luhn Algorithm (MOD-10):** Validates credit card number sequences.
   - **ISO 7064 Mod-97-10:** Verifies International Bank Account Numbers (IBAN).
   - **Modulo-11:** Verifies UK National Health Service (NHS) numbers.
   - **Base58 / Bech32 Checksums:** Verifies Bitcoin and cryptocurrency wallet addresses.
3. **spaCy Statistical NER:** Identifies unstructured, context-dependent entities like personal names, locations, and organizations using pre-trained token embeddings and linguistic features.
4. **Context Proximity Scoring:** Scans adjacent words surrounding candidate tokens (e.g., finding the word "account" within 5 words of a 10-digit number). If context words match, the confidence score is boosted (e.g., from `0.40` to `0.85`).

---

## 3. Comprehensive Catalog of Detected PII Entities

Microsoft Presidio in PII Sentinel detects **36 distinct PII and Secret entity types**, categorized across 8 primary domains:

| # | Entity Type | Domain | Primary Mechanism | Context Proximity Boost Keywords |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `IN_AADHAAR` | India PII | Regex + **Verhoeff Algorithm Checksum** | `aadhaar`, `aadhar`, `uidai`, `uid`, `resident id`, `identity number` |
| 2 | `IN_PAN` | India PII | 10-Char Entity-Code Regex + General | `pan`, `pan card`, `income tax`, `permanent account number`, `nsdl` |
| 3 | `IN_GSTIN` | India PII | 15-Char GSTIN Regex + State Codes | `gst`, `gstin`, `goods and services tax`, `tax invoice`, `gst number` |
| 4 | `IN_IFSC` | India PII | 11-Char Bank/Branch Code Regex | `ifsc`, `ifsc code`, `rtgs`, `neft`, `imps`, `bank branch`, `branch code` |
| 5 | `IN_PASSPORT` | India PII | Letter + 7 Digits Regex | `passport`, `passport no`, `republic of india`, `indian passport` |
| 6 | `IN_VOTER_ID` | India PII | 3 Letters + 7 Digits Regex | `voter`, `epic`, `voter id`, `election commission`, `electoral`, `eci` |
| 7 | `AWS_ACCESS_KEY` | Secrets / Cloud | AKIA/ASIA 20-Char Regex | `aws`, `amazon`, `access_key`, `secret_key`, `s3`, `iam`, `credential` |
| 8 | `GITHUB_TOKEN` | Secrets / Developer | ghp_ Classic & Fine-Grained Regex | `github`, `token`, `pat`, `personal access token`, `repo`, `bearer` |
| 9 | `OPENAI_API_KEY` | Secrets / AI | sk- & sk-proj- Key Regex | `openai`, `api_key`, `chatgpt`, `gpt-4`, `sk-`, `bearer` |
| 10 | `GOOGLE_API_KEY` | Secrets / Cloud | AIza 39-Char Key Regex | `google`, `gcp`, `api_key`, `firebase`, `cloud`, `maps` |
| 11 | `SLACK_TOKEN` | Secrets / Messaging | xoxb/xoxp/xoxa Tokens & Webhooks | `slack`, `bot_token`, `webhook`, `chat:write`, `channel` |
| 12 | `PRIVATE_KEY` | Secrets / Cryptography | PEM Private Key Headers | `key`, `pem`, `ssh`, `ssl`, `private`, `certificate`, `id_rsa` |
| 13 | `JWT_TOKEN` | Secrets / Auth | Base64url 3-Segment Bearer Regex | `jwt`, `token`, `bearer`, `authorization`, `auth`, `access_token` |
| 14 | `CREDIT_CARD` | Financial | Regex + Luhn MOD-10 Checksum | `credit`, `card`, `visa`, `mastercard`, `cc`, `amex`, `discover`, `jcb` |
| 15 | `US_BANK_NUMBER` | Financial | Regex + Banking Context | `check`, `account`, `account#`, `acct`, `bank`, `save`, `debit` |
| 16 | `IBAN_CODE` | Financial | Regex + ISO 7064 Mod-97 Checksum | `iban`, `bank`, `transaction`, `wire`, `swift` |
| 17 | `CRYPTO` | Financial | Regex + Base58/Bech32 Validation | `wallet`, `btc`, `bitcoin`, `crypto`, `eth`, `address` |
| 18 | `US_SSN` | Government / US | Regex + Area/Group Code Rules | `social`, `security`, `ssn`, `ssns`, `ssid` |
| 19 | `US_PASSPORT` | Government / US | Alphanumeric Regex + Context | `us`, `united`, `states`, `passport`, `passport#`, `travel` |
| 20 | `US_DRIVER_LICENSE` | Government / US | Multi-State Regexes + Context | `driver`, `license`, `permit`, `lic`, `identification`, `dls`, `cdls` |
| 21 | `US_ITIN` | Government / US | 9-Digit Tax Regex + Range Rules | `individual`, `taxpayer`, `itin`, `tax`, `payer`, `taxid`, `tin` |
| 22 | `UK_NHS` | Government / UK | 10-Digit Regex + Modulo-11 | `national health service`, `nhs`, `health services authority` |
| 23 | `PERSON` | Identity | spaCy NER (`en_core_web_sm`) | Natural language sentence structure, honorifics (Mr., Dr.) |
| 24 | `LOCATION` | Demographic | spaCy NER (`GPE` / `LOC`) | Geographic entities, cities, states, countries, street addresses |
| 25 | `ORGANIZATION` | Corporate / Legal | spaCy NER (`ORG`) | Company names, agencies, educational institutions, non-profits |
| 26 | `NRP` | Identity / Demographic | spaCy NER (`NORP`) | Nationalities, religious groups, political affiliations |
| 27 | `AGE` | Demographic | spaCy NER + Pattern Rules | Contextual age phrases ("35 years old", "age 42") |
| 28 | `ID` | Identification | spaCy NER (`CARDINAL`/`ID`) | Alphanumeric tracking numbers, employee identifiers |
| 29 | `EMAIL_ADDRESS` | Contact | RFC 5322 Standard Regex | `email`, `e-mail`, `mailto`, `contact` |
| 30 | `EMAIL` | Contact | spaCy Linguistic Classifier | Secondary fallback for email identifiers in free text |
| 31 | `PHONE_NUMBER` | Contact | `phonenumbers` (libphonenumber) | `phone`, `number`, `telephone`, `cell`, `cellphone`, `mobile` |
| 32 | `URL` | Network / Web | Strict URI/URL RFC 3986 Regex | `url`, `website`, `link`, `http`, `https` |
| 33 | `IP_ADDRESS` | Network / Technical | IPv4 (0-255 octets) & IPv6 Regex | `ip`, `ipv4`, `ipv6`, `host`, `address` |
| 34 | `MAC_ADDRESS` | Network / Technical | EUI-48 / EUI-64 Hexadecimal Regex | `mac`, `mac address`, `hardware address`, `physical address` |
| 35 | `MEDICAL_LICENSE` | Healthcare | DEA & State Medical Board Regex | `medical`, `certificate`, `DEA`, `physician`, `doctor`, `license` |
| 36 | `DATE_TIME` | Temporal / Audit | 13 Date Patterns + spaCy `DATE` | `date`, `birthday`, `dob`, `born`, `issued`, `expires` |

---

## 4. Entity Deep Dive: Specifications & Match Criteria

### 4.1. Financial Identifiers

#### `CREDIT_CARD`
- **Recognized Formats:** 13 to 19 digits with optional hyphens or spaces.
- **Brands Supported:** Visa (starts with 4), MasterCard (starts with 51-55 or 2221-2720), American Express (starts with 34 or 37), Discover (starts with 6011, 65, or 644-649), JCB, Diners Club, Maestro.
- **Verification:** Candidates that match the pattern **must** pass the **Luhn MOD-10 checksum**. Raw strings that fail Luhn are discarded with 0.0 score, preventing false positive number sequences from being flagged.

#### `IBAN_CODE`
- **Recognized Formats:** 15 to 34 alphanumeric characters starting with a 2-letter ISO 3166 country code, followed by 2 check digits and up to 30 alphanumeric basic bank account numbers (BBAN).
- **Verification:** Runs **ISO 7064 Mod-97-10** check. If check digits do not equate to `1`, the candidate is rejected.

#### `CRYPTO`
- **Recognized Formats:**
  - Bitcoin P2PKH (starts with `1`, 26-35 characters, Base58)
  - Bitcoin P2SH (starts with `3`, 26-35 characters, Base58)
  - Bitcoin Bech32 SegWit (starts with `bc1`, 42-62 characters, lowercase alphanumeric)
- **Verification:** Validates characters against Base58/Bech32 character sets.

#### `US_BANK_NUMBER`
- **Recognized Formats:** 9-digit ABA routing numbers and 6-to-17-digit bank account numbers.
- **Verification:** Requires proximity to context keywords (`account`, `checking`, `routing`, `bank`, `aba`).

---

### 4.2. Government & Legal Identifiers

#### `US_SSN`
- **Recognized Formats:**
  - Standard formatted: `XXX-XX-XXXX`
  - Unformatted: `XXXXXXXXX` (9 consecutive digits)
- **Validation Rules:**
  - Area number (first 3 digits) cannot be `000`, `666`, or `900-999`.
  - Group number (middle 2 digits) cannot be `00`.
  - Serial number (last 4 digits) cannot be `0000`.
- **Score Dynamics:** Formatted SSNs receive a base score of `0.85`. Unformatted 9-digit numbers receive a low initial score (`0.30`) and require proximity to words like `"ssn"`, `"social security"`, or `"tax id"` to exceed the 0.60 threshold.

#### `US_PASSPORT`
- **Recognized Formats:** 9 digits (standard) or 1 letter followed by 8 digits (passport cards/travel documents).
- **Context Gate:** Requires passport-related context words within 5 tokens to eliminate standard 9-digit serial numbers.

#### `US_DRIVER_LICENSE`
- **Recognized Formats:** Specific state-level compiled regex patterns covering California, New York, Texas, Florida, Illinois, Pennsylvania, and other major states.

#### `UK_NHS`
- **Recognized Formats:** 10 digits formatted as `XXX XXX XXXX` or `XXXXXXXXXX`.
- **Verification:** Enforces **Modulo-11** checksum where the 10th digit is the calculated check digit.

---

### 4.3. Personal & Demographic Data (spaCy Statistical Engine)

#### `PERSON`
- **Model:** `en_core_web_sm` Named Entity Recognition pipeline.
- **Mechanism:** Parses syntactic dependency parse trees, capitalization patterns, and surrounding context (e.g. "Signed by Alice Smith", "Attn: Robert Johnson").
- **Typical Confidence:** `0.80` - `0.90`.

#### `LOCATION`
- **Model:** Detects geopolitical entities (`GPE`) and physical locations (`LOC`).
- **Examples:** "1600 Pennsylvania Avenue", "Seattle, WA", "Frankfurt am Main, Germany".

#### `NRP` (Nationality, Religious, or Political groups)
- **Examples:** "Canadian", "Christian", "Republican", "Buddhist", "Sikh", "Labour Party".

---

### 4.4. Contact & Network Identifiers

#### `EMAIL_ADDRESS`
- **Specification:** Complies with RFC 5322 specifications.
- **Pattern:** `[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+`
- **Base Score:** `1.00` (High determinism; low false positive risk).

#### `PHONE_NUMBER`
- **Engine:** Google `libphonenumber` wrapper (`phonenumbers` library).
- **Capabilities:** Validates domestic US formats `(555) 123-4567`, international formats `+44 20 7946 0958`, dashed, spaced, and dot-separated notations.

#### `IP_ADDRESS`
- **IPv4:** Evaluates four decimal octets (`0` to `255`) separated by dots.
- **IPv6:** Evaluates eight 16-bit hexadecimal blocks separated by colons (supports `::` zero-compression notation).

#### `MAC_ADDRESS`
- **Specification:** Six pairs of hexadecimal digits separated by hyphens (`00-14-22-01-23-45`) or colons (`00:14:22:01:23:45`).

---

### 4.5. India-Specific PII Identifiers

#### `IN_AADHAAR`
- **Specification:** 12-digit Unique Identification Authority of India (UIDAI) identity number.
- **Format:** Formatted as `XXXX XXXX XXXX` or `XXXX-XXXX-XXXX`, or 12 consecutive digits.
- **Verification Engine:** **Verhoeff Mathematical Checksum**.
  - Any 12-digit number sequence detected by the regex is automatically tested against the Verhoeff dihedral group D5 multiplication table.
  - Candidates failing the checksum are **immediately rejected** (score 0.0).
  - Valid candidates receive `0.85` base score, boosted to `1.00` when adjacent to context words like `"aadhaar"`, `"uidai"`, or `"resident id"`.

#### `IN_PAN`
- **Specification:** Indian Income Tax Department Permanent Account Number.
- **Format:** 10 alphanumeric characters (`[A-Z]{5}[0-9]{4}[A-Z]{1}`).
- **Structure:**
  - 4th character designates taxpayer category: `P` (Person/Individual), `C` (Company), `H` (HUF), `F` (Firm), `A` (Association of Persons), `T` (Trust), `B` (Body of Individuals), `L` (Local Authority), `J` (Artificial Juridical Person), `G` (Government).
  - 5th character represents the first letter of the taxpayer's surname or entity name.
- **Score Dynamics:** Strict category PANs receive `0.85` base score. General 5-letter PANs receive `0.40` boosted to `0.90` near context keywords (`"pan"`, `"income tax"`, `"form 16"`, `"itr"`).

#### `IN_GSTIN`
- **Specification:** Goods and Services Tax Identification Number.
- **Format:** 15 characters (`[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}`).
- **Structure:** 2-digit State Code (01-38) + 10-character PAN + 1-digit entity count + `Z` + 1 check digit.

#### `IN_IFSC`
- **Specification:** Indian Financial System Code for electronic fund transfers (NEFT, RTGS, IMPS).
- **Format:** 11 characters (`[A-Z]{4}0[A-Z0-9]{6}`).
- **Structure:** 4-letter bank code + strictly `0` (reserved 5th character) + 6-character branch identifier.

#### `IN_PASSPORT`
- **Specification:** Republic of India Passport Booklet Number.
- **Format:** 1 uppercase letter (`[A-PR-WYZ]`) + 7 consecutive digits.
- **Context Gate:** Requires proximity to passport-related context (`"passport"`, `"republic of india"`, `"place of issue"`) to prevent collision with generic 8-character codes.

#### `IN_VOTER_ID`
- **Specification:** Elector's Photo Identity Card (EPIC) issued by Election Commission of India.
- **Format:** 3 uppercase letters (Assembly/State code) + 7 digits (`[A-Z]{3}[0-9]{7}`).

---

### 4.6. Developer Secrets, API Keys & Cloud Credentials

#### `AWS_ACCESS_KEY`
- **Specification:** Amazon Web Services Access Key IDs.
- **Prefixes:** `AKIA` (standard IAM user), `ASIA` (temporary STS credential), `AROA` (IAM role), `AIPA` (EC2 instance profile).
- **Format:** 20 alphanumeric uppercase characters.
- **Score:** `0.95`.

#### `GITHUB_TOKEN`
- **Specification:** GitHub Personal Access Tokens (PATs) and OAuth tokens.
- **Classic Tokens:** Starts with `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` + 36 characters (Base62).
- **Fine-Grained PATs:** Starts with `github_pat_` + 82 characters.
- **Score:** `0.95` - `0.98`.

#### `OPENAI_API_KEY`
- **Specification:** OpenAI API Secret Keys.
- **Format:** Starts with `sk-` (legacy) or `sk-proj-` (modern project keys) followed by 20 to 100 base64url characters.
- **Score:** `0.90` (Boosted to `1.00` near `"openai"`, `"chatgpt"`).

#### `GOOGLE_API_KEY`
- **Specification:** Google Cloud Platform, Firebase, and Google Maps API Keys.
- **Format:** Starts with `AIza` followed by 35 alphanumeric characters or `-_` (total 39 characters).
- **Score:** `0.95`.

#### `SLACK_TOKEN`
- **Specification:** Slack Bot Tokens (`xoxb-`), User Tokens (`xoxp-`), App Tokens (`xoxa-`), and Incoming Webhook URLs.
- **Score:** `0.95` - `0.98`.

#### `PRIVATE_KEY`
- **Specification:** PEM-formatted cryptographic private keys (RSA, ECDSA, Ed25519, DSA, OpenSSH, PGP).
- **Format:** `-----BEGIN (RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED) PRIVATE KEY-----`.
- **Score:** `1.00` (Deterministic header detection).

#### `JWT_TOKEN`
- **Specification:** JSON Web Tokens (RFC 7519).
- **Format:** Three base64url encoded parts separated by periods (`header.payload.signature`). Starts with `ey...`.

---

## 5. Confidence Thresholds & Tuning Strategy

In **PII Sentinel**, the user can configure the **Minimum Confidence Threshold** on a continuous slider from **10% (0.10) to 100% (1.00)** (Default: **60% / 0.60**).

| Threshold Tier | Setting | Best For | Behavior |
| :--- | :---: | :--- | :--- |
| **High Sensitivity** | `0.30 - 0.45` | Legal Discovery & Forensics | Flags ambiguous numbers, unformatted sequences, and potential name mentions. Higher false-positive rate. |
| **Balanced (Recommended)** | `0.60 - 0.70` | Corporate Audits & Routine Scans | Optimum balance. Catches all formatted PII, checksum-verified financials, emails, phones, and high-confidence names while ignoring isolated numerical noise. |
| **High Precision** | `0.80 - 1.00` | Automated Redaction Pipelines | Only returns entities that possess mathematical checksum verification (Luhn/Mod-97) or explicit context keywords (e.g. `SSN: 123-45-6789`). |

---

## 6. Secure Redaction Preview Logic

PII Sentinel produces privacy-preserving redacted previews for every finding using [`backend/presidio_detector.py:redact_value()`](file:///c:/PIISentinalApp/backend/presidio_detector.py#L21-L41):

```python
def redact_value(value: str) -> str:
    """
    Retains only the first 2 and last 2 characters to provide operational context
    while masking sensitive middle characters with asterisks (capped at 8).
    """
```

### Transformation Examples:
| Raw Value | Redacted Preview | Privacy Benefit |
| :--- | :--- | :--- |
| `john.doe@company.com` | `jo********om` | Verifies domain and email structure without exposing identity |
| `4111-2222-3333-4444` | `41********44` | Matches standard PCI-DSS masking standards |
| `123-45-6789` | `12********89` | Confirms SSN presence without storing or showing plaintext |
| `192.168.1.105` | `19********05` | Retains subnet hints while masking exact host address |
| `secret` | `se**et` | Prevents short token identification |

---

## 7. Adding Custom PII Recognizers

Developers can easily register custom organizational recognizers (e.g. Employee ID, Internal Project Code, Secret Tokens) into the Presidio analyzer:

```python
from presidio_analyzer import PatternRecognizer, Pattern

# 1. Define custom regex pattern
employee_id_pattern = Pattern(
    name="employee_id_pattern",
    regex=r"\bEMP-[0-9]{6}\b",
    score=0.85
)

# 2. Instantiate custom recognizer with context keywords
custom_recognizer = PatternRecognizer(
    supported_entity="EMPLOYEE_ID",
    patterns=[employee_id_pattern],
    context=["employee", "staff", "badge", "id"]
)

# 3. Register into active analyzer engine
detector = PresidioDetector.get_instance()
detector._ensure_analyzer()
detector._analyzer.registry.add_recognizer(custom_recognizer)
```

Once registered, `EMPLOYEE_ID` will automatically appear in the GUI's **PII Detection Types** checklist and be scanned in recursive audits.
