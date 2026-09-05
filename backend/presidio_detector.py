"""
Microsoft Presidio PII Detection Engine
Uses built-in recognizers only (no custom regex).
Dynamically discovers supported entities at runtime and filters by confidence.
Includes secure redaction previews and chunking for large documents.
"""

import logging
from typing import List, Dict, Any, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# Fallback entity list in case engine is still initializing
DEFAULT_ENTITIES = [
    "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "PERSON",
    "IP_ADDRESS", "US_SSN", "US_PASSPORT", "IBAN_CODE",
    "CRYPTO", "DATE_TIME", "LOCATION", "URL"
]


def redact_value(value: str) -> str:
    """
    Produce a secure redacted preview of a detected PII value.
    Shows only the first and last 2 characters to protect privacy.
    E.g. 'john.doe@example.com' -> 'jo****om'
         '4111222233334444' -> '41********44'
         'short' -> 's***t'
    """
    if not value:
        return ""
    val_clean = value.strip()
    length = len(val_clean)
    if length <= 2:
        return "**"
    elif length <= 4:
        return val_clean[0] + "*" * (length - 2) + val_clean[-1]
    else:
        # Cap asterisk length to at most 8 so previews remain compact
        masked_len = min(length - 4, 8)
        return val_clean[:2] + ("*" * masked_len) + val_clean[-2:]


class PresidioDetector:
    """Wrapper around Microsoft Presidio AnalyzerEngine."""

    _instance: Optional["PresidioDetector"] = None

    def __init__(self, language: str = "en"):
        self.language = language
        self._analyzer = None
        self._supported_entities: List[str] = []

    @classmethod
    def get_instance(cls, language: str = "en") -> "PresidioDetector":
        """Singleton accessor to prevent reloading heavy NLP models."""
        if cls._instance is None:
            cls._instance = PresidioDetector(language=language)
        return cls._instance

    def _ensure_analyzer(self) -> None:
        """Initialize AnalyzerEngine lazily."""
        if self._analyzer is None:
            logger.info("Initializing Microsoft Presidio AnalyzerEngine...")
            try:
                from presidio_analyzer import AnalyzerEngine
                from presidio_analyzer.nlp_engine import SpacyNlpEngine

                nlp_engine = None
                # 1. Try direct import of en_core_web_sm (most reliable in PyInstaller bundles)
                try:
                    import en_core_web_sm
                    nlp = en_core_web_sm.load()
                    nlp_engine = SpacyNlpEngine(models=[{"lang_code": "en", "model_name": "en_core_web_sm"}])
                    nlp_engine.nlp = {"en": nlp}
                    nlp_engine.is_loaded = lambda: True
                except Exception as direct_err:
                    logger.warning(f"Direct en_core_web_sm load fallback: {direct_err}")

                # 2. Try spacy.load if direct import failed
                if nlp_engine is None:
                    try:
                        import spacy
                        nlp = spacy.load("en_core_web_sm")
                        nlp_engine = SpacyNlpEngine(models=[{"lang_code": "en", "model_name": "en_core_web_sm"}])
                        nlp_engine.nlp = {"en": nlp}
                        nlp_engine.is_loaded = lambda: True
                    except Exception as spacy_err:
                        logger.warning(f"spacy.load fallback: {spacy_err}")

                if nlp_engine is not None:
                    self._analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
                else:
                    self._analyzer = AnalyzerEngine()

                # Register custom India PII and Developer Secret recognizers
                try:
                    from backend.custom_recognizers import get_custom_recognizers
                    for rec in get_custom_recognizers():
                        self._analyzer.registry.add_recognizer(rec)
                    logger.info("Custom India PII & Secret recognizers registered.")
                except Exception as custom_err:
                    logger.warning(f"Failed to load custom recognizers: {custom_err}")

                raw_entities = self._analyzer.get_supported_entities(language=self.language)
                self._supported_entities = sorted(list(raw_entities))
                logger.info(f"Presidio initialized. Supported entities ({len(self._supported_entities)}): {self._supported_entities}")
            except Exception as e:
                logger.error(f"Failed to initialize Presidio AnalyzerEngine: {e}")
                self._supported_entities = DEFAULT_ENTITIES
                raise

    def get_supported_entities(self) -> List[str]:
        """Dynamically return all supported built-in entities."""
        try:
            self._ensure_analyzer()
            return list(self._supported_entities)
        except Exception:
            return list(DEFAULT_ENTITIES)

    def analyze_text(
        self,
        text: str,
        entities: Optional[List[str]] = None,
        score_threshold: float = 0.6
    ) -> List[Dict[str, Any]]:
        """
        Analyze extracted text for PII entities.
        Returns a list of finding dictionaries:
        [
            {
                "entity": str,
                "value": str,
                "value_redacted": str,
                "confidence": float,
                "start": int,
                "end": int
            }
        ]
        """
        if not text or not text.strip():
            return []

        self._ensure_analyzer()

        # If entities is empty or None, use all supported
        active_entities = entities if entities else None

        findings: List[Dict[str, Any]] = []

        # Microsoft Presidio / spaCy limit: chunk large documents > 200,000 characters
        chunk_size = 150000
        overlap = 500

        text_length = len(text)
        if text_length <= chunk_size:
            findings = self._analyze_chunk(text, 0, active_entities, score_threshold)
        else:
            # Process in overlapping chunks
            start = 0
            seen_spans: Set[Tuple[int, int, str]] = set()
            while start < text_length:
                end = min(start + chunk_size, text_length)
                chunk = text[start:end]
                chunk_findings = self._analyze_chunk(chunk, start, active_entities, score_threshold)

                for f in chunk_findings:
                    span_key = (f["start"], f["end"], f["entity"])
                    if span_key not in seen_spans:
                        seen_spans.add(span_key)
                        findings.append(f)

                if end == text_length:
                    break
                start = end - overlap

        return findings

    def _analyze_chunk(
        self,
        chunk_text: str,
        offset: int,
        entities: Optional[List[str]],
        score_threshold: float
    ) -> List[Dict[str, Any]]:
        findings = []
        try:
            results = self._analyzer.analyze(
                text=chunk_text,
                entities=entities,
                language=self.language,
                score_threshold=score_threshold
            )

            for r in results:
                raw_val = chunk_text[r.start:r.end]
                findings.append({
                    "entity": r.entity_type,
                    "value": raw_val,
                    "value_redacted": redact_value(raw_val),
                    "confidence": round(float(r.score), 2),
                    "start": offset + r.start,
                    "end": offset + r.end
                })
        except Exception as e:
            logger.warning(f"Presidio analyze error on text chunk (offset={offset}): {e}")

        return findings
