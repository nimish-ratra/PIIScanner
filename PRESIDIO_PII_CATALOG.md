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
- **Hybrid Detection:** Combines statistical machine learning (spaCy NER), deterministic pattern matching (regular expressions), mathematical checksum validations (Luhn algorithm, ISO 7064 Mod-97), and contextual word proximity boosts.
- **Dynamic Entity Discovery:** Supports **23 distinct PII entity types** out of the box, dynamically queried at runtime via `analyzer.get_supported_entities()`.
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
                    │  like 'card', 'ssn' are near) │
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
   - **Luhn Algorithm (MOD-10):** Validates credit card number sequences.
   - **ISO 7064 Mod-97-10:** Verifies International Bank Account Numbers (IBAN).
   - **Modulo-11:** Verifies UK National Health Service (NHS) numbers.
   - **Base58 / Bech32 Checksums:** Verifies Bitcoin and cryptocurrency wallet addresses.
3. **spaCy Statistical NER:** Identifies unstructured, context-dependent entities like personal names, locations, and organizations using pre-trained token embeddings and linguistic features.
4. **Context Proximity Scoring:** Scans adjacent words surrounding candidate tokens (e.g., finding the word "account" within 5 words of a 10-digit number). If context words match, the confidence score is boosted (e.g., from `0.40` to `0.85`).

---

## 3. Comprehensive Catalog of Detected PII Entities

Microsoft Presidio in PII Sentinel detects **23 distinct PII entity types**, categorized across 6 primary domains:

| # | Entity Type | Domain | Primary Mechanism | Context Proximity Boost Keywords |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `CREDIT_CARD` | Financial | Regex + Luhn MOD-10 Checksum | `credit`, `card`, `visa`, `mastercard`, `cc`, `amex`, `discover`, `jcb`, `diners` |
| 2 | `US_BANK_NUMBER` | Financial | Regex + Banking Context | `check`, `account`, `account#`, `acct`, `bank`, `save`, `debit` |
| 3 | `IBAN_CODE` | Financial | Regex + ISO 7064 Mod-97 Checksum | `iban`, `bank`, `transaction`, `wire`, `swift` |
| 4 | `CRYPTO` | Financial | Regex + Base58/Bech32 Validation | `wallet`, `btc`, `bitcoin`, `crypto`, `eth`, `address` |
| 5 | `US_SSN` | Government / Legal | Regex + Area/Group Code Rules | `social`, `security`, `ssn`, `ssns`, `ssid` |
| 6 | `US_PASSPORT` | Government / Legal | Alphanumeric Regex + Context | `us`, `united`, `states`, `passport`, `passport#`, `travel`, `document` |
| 7 | `US_DRIVER_LICENSE` | Government / Legal | Multi-State Regexes + Context | `driver`, `license`, `permit`, `lic`, `identification`, `dls`, `cdls`, `lic#` |
| 8 | `US_ITIN` | Government / Legal | 9-Digit Tax Regex + Range Rules | `individual`, `taxpayer`, `itin`, `tax`, `payer`, `taxid`, `tin` |
| 9 | `UK_NHS` | Government / Healthcare | 10-Digit Regex + Modulo-11 | `national health service`, `nhs`, `health services authority` |
| 10 | `PERSON` | Identity | spaCy NER (`en_core_web_sm`) | Natural language sentence structure, honorifics (Mr., Dr.) |
| 11 | `LOCATION` | Demographic | spaCy NER (`GPE` / `LOC`) | Geographic entities, cities, states, countries, street addresses |
| 12 | `ORGANIZATION` | Corporate / Legal | spaCy NER (`ORG`) | Company names, agencies, educational institutions, non-profits |
| 13 | `NRP` | Identity / Demographic | spaCy NER (`NORP`) | Nationalities, religious groups, political affiliations |
| 14 | `AGE` | Demographic | spaCy NER + Pattern Rules | Contextual age phrases ("35 years old", "age 42") |
| 15 | `ID` | Identification | spaCy NER (`CARDINAL`/`ID`) | Alphanumeric tracking numbers, employee identifiers |
| 16 | `EMAIL_ADDRESS` | Contact | RFC 5322 Standard Regex | `email`, `e-mail`, `mailto`, `contact` |
| 17 | `EMAIL` | Contact | spaCy Linguistic Classifier | Secondary fallback for email identifiers in free text |
| 18 | `PHONE_NUMBER` | Contact | `phonenumbers` (libphonenumber) | `phone`, `number`, `telephone`, `cell`, `cellphone`, `mobile`, `call`, `fax` |
| 19 | `URL` | Network / Web | Strict URI/URL RFC 3986 Regex | `url`, `website`, `link`, `http`, `https` |
| 20 | `IP_ADDRESS` | Network / Technical | IPv4 (0-255 octets) & IPv6 Regex | `ip`, `ipv4`, `ipv6`, `host`, `address` |
| 21 | `MAC_ADDRESS` | Network / Technical | EUI-48 / EUI-64 Hexadecimal Regex | `mac`, `mac address`, `hardware address`, `physical address`, `ethernet` |
| 22 | `MEDICAL_LICENSE` | Healthcare | DEA & State Medical Board Regex | `medical`, `certificate`, `DEA`, `physician`, `doctor`, `license` |
| 23 | `DATE_TIME` | Temporal / Audit | 13 Date Patterns + spaCy `DATE` | `date`, `birthday`, `dob`, `born`, `issued`, `expires` |

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
