"""PrisonBreak local RAG worker.

The worker accepts one JSON request on stdin and emits one JSON response on
stdout. It uses Qdrant's persistent local mode plus FastEmbed.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import sys
import uuid
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from xml.etree import ElementTree


DEFAULT_COLLECTION = "prisonbreak_rag_v1"
DEFAULT_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
SCHEMA_VERSION = 1
POINT_NAMESPACE = uuid.UUID("4c69eb75-9c27-4f71-90ac-9e8de7c39cd4")


class RagWorkerError(RuntimeError):
    """Expected request or dependency failure with a concise public message."""


@dataclass(frozen=True)
class RagConfig:
    store_path: Path
    collection_name: str
    embedding_model: str
    model_cache_path: Path
    chunk_words: int
    chunk_overlap: int

    @classmethod
    def from_request(cls, raw: Mapping[str, Any] | None) -> "RagConfig":
        raw = raw or {}
        cwd = Path.cwd()
        store_path = Path(
            str(
                raw.get("store_path")
                or os.environ.get("PRISONBREAK_QDRANT_PATH")
                or cwd / "data" / "qdrant"
            )
        ).expanduser().resolve()
        collection = str(
            raw.get("collection_name")
            or os.environ.get("PRISONBREAK_RAG_COLLECTION")
            or DEFAULT_COLLECTION
        ).strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", collection):
            raise RagWorkerError("collection_name contains unsupported characters")

        embedding_model = str(
            raw.get("embedding_model")
            or os.environ.get("PRISONBREAK_EMBEDDING_MODEL")
            or DEFAULT_EMBEDDING_MODEL
        ).strip()
        if not embedding_model:
            raise RagWorkerError("embedding_model must not be empty")

        model_cache_path = Path(
            str(
                raw.get("model_cache_path")
                or os.environ.get("PRISONBREAK_FASTEMBED_CACHE")
                or cwd / "data" / "fastembed"
            )
        ).expanduser().resolve()
        chunk_words = int(raw.get("chunk_words") or 220)
        chunk_overlap = int(raw.get("chunk_overlap") if raw.get("chunk_overlap") is not None else 40)
        if chunk_words < 4 or chunk_words > 2_000:
            raise RagWorkerError("chunk_words must be between 4 and 2000")
        if chunk_overlap < 0 or chunk_overlap >= chunk_words:
            raise RagWorkerError("chunk_overlap must be non-negative and smaller than chunk_words")

        return cls(
            store_path=store_path,
            collection_name=collection,
            embedding_model=embedding_model,
            model_cache_path=model_cache_path,
            chunk_words=chunk_words,
            chunk_overlap=chunk_overlap,
        )


@dataclass(frozen=True)
class SourceIdentity:
    case_id: str
    corpus: str
    source_id: str
    source_label: str


@dataclass(frozen=True)
class ParsedBlock:
    locator: str
    text: str


@dataclass(frozen=True)
class RagChunk:
    point_id: str
    chunk_index: int
    locator: str
    passage: str
    content_hash: str


def _required_string(raw: Mapping[str, Any], key: str, *, max_length: int = 512) -> str:
    value = str(raw.get(key, "")).strip()
    if not value:
        raise RagWorkerError(f"{key} must not be empty")
    if len(value) > max_length:
        raise RagWorkerError(f"{key} exceeds {max_length} characters")
    return value


def _identity(raw: Mapping[str, Any], *, require_label: bool = True) -> SourceIdentity:
    case_id = _required_string(raw, "case_id", max_length=128)
    corpus = _required_string(raw, "corpus", max_length=128)
    source_id = _required_string(raw, "source_id", max_length=512)
    source_label = (
        _required_string(raw, "source_label", max_length=512)
        if require_label
        else str(raw.get("source_label") or source_id).strip()
    )
    return SourceIdentity(case_id, corpus, source_id, source_label)


def _metadata(raw: Mapping[str, Any]) -> dict[str, Any]:
    value = raw.get("metadata") or {}
    if not isinstance(value, dict):
        raise RagWorkerError("metadata must be a JSON object")
    try:
        json.dumps(value)
    except (TypeError, ValueError) as exc:
        raise RagWorkerError(f"metadata is not JSON-serializable: {exc}") from exc
    return value


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _text_blocks(text: str, prefix: str = "text") -> list[ParsedBlock]:
    lines = text.splitlines()
    blocks: list[ParsedBlock] = []
    start: int | None = None
    parts: list[str] = []

    def flush(end_line: int) -> None:
        nonlocal start, parts
        if start is None:
            return
        normalized = _normalize_text("\n".join(parts))
        if normalized:
            blocks.append(ParsedBlock(f"{prefix}:lines:{start}-{end_line}", normalized))
        start = None
        parts = []

    for line_no, line in enumerate(lines, start=1):
        if line.strip():
            if start is None:
                start = line_no
            parts.append(line)
        else:
            flush(line_no - 1)
    flush(len(lines))
    return blocks


class _BlockHtmlParser(HTMLParser):
    BLOCK_TAGS = {
        "address", "article", "blockquote", "dd", "div", "dt", "figcaption",
        "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "pre", "td", "th",
    }
    SUPPRESSED_TAGS = {"script", "style", "noscript", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[ParsedBlock] = []
        self._active_tag: str | None = None
        self._parts: list[str] = []
        self._suppressed_depth = 0
        self._fallback_parts: list[str] = []
        self._ordinal = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in self.SUPPRESSED_TAGS:
            self._suppressed_depth += 1
            return
        if self._suppressed_depth:
            return
        if tag == "br" and self._active_tag:
            self._parts.append(" ")
        elif tag in self.BLOCK_TAGS and self._active_tag is None:
            self._active_tag = tag
            self._parts = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.SUPPRESSED_TAGS and self._suppressed_depth:
            self._suppressed_depth -= 1
            return
        if self._suppressed_depth:
            return
        if tag == self._active_tag:
            text = _normalize_text(" ".join(self._parts))
            if text:
                self._ordinal += 1
                self.blocks.append(ParsedBlock(f"html:{tag}:{self._ordinal}", text))
            self._active_tag = None
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._suppressed_depth:
            return
        if data.strip():
            self._fallback_parts.append(data)
            if self._active_tag:
                self._parts.append(data)

    def fallback(self) -> list[ParsedBlock]:
        text = _normalize_text(" ".join(self._fallback_parts))
        return [ParsedBlock("html:document:1", text)] if text else []


def _html_blocks(text: str) -> list[ParsedBlock]:
    parser = _BlockHtmlParser()
    parser.feed(text)
    parser.close()
    return parser.blocks or parser.fallback()


def _docx_blocks(path: Path) -> list[ParsedBlock]:
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise RagWorkerError(f"Invalid DOCX file: {path.name}") from exc

    root = ElementTree.fromstring(xml)
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    body = root.find(f".//{namespace}body")
    if body is None:
        return []

    blocks: list[ParsedBlock] = []
    paragraph_no = 0
    table_no = 0
    for child in list(body):
        if child.tag == f"{namespace}p":
            paragraph_no += 1
            text = _normalize_text(" ".join(node.text or "" for node in child.iter(f"{namespace}t")))
            if text:
                blocks.append(ParsedBlock(f"docx:paragraph:{paragraph_no}", text))
        elif child.tag == f"{namespace}tbl":
            table_no += 1
            for row_no, row in enumerate(child.findall(f"{namespace}tr"), start=1):
                for cell_no, cell in enumerate(row.findall(f"{namespace}tc"), start=1):
                    text = _normalize_text(" ".join(node.text or "" for node in cell.iter(f"{namespace}t")))
                    if text:
                        locator = f"docx:table:{table_no}:row:{row_no}:cell:{cell_no}"
                        blocks.append(ParsedBlock(locator, text))
    return blocks


def _pdf_blocks(path: Path) -> list[ParsedBlock]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RagWorkerError(
            "PDF parsing requires pypdf; install server/rag/requirements.txt"
        ) from exc

    try:
        reader = PdfReader(str(path))
        blocks = []
        for page_no, page in enumerate(reader.pages, start=1):
            text = _normalize_text(page.extract_text() or "")
            if text:
                blocks.append(ParsedBlock(f"pdf:page:{page_no}", text))
        return blocks
    except Exception as exc:
        raise RagWorkerError(f"Unable to parse PDF {path.name}: {exc}") from exc


def parse_document(path: Path, mime_type: str | None = None) -> tuple[bytes, list[ParsedBlock]]:
    if not path.is_file():
        raise RagWorkerError(f"Source file not found: {path}")
    raw = path.read_bytes()
    suffix = path.suffix.lower()
    mime = (mime_type or "").split(";", 1)[0].strip().lower()

    if suffix in {".txt", ".md", ".markdown"} or mime in {"text/plain", "text/markdown"}:
        prefix = "markdown" if suffix in {".md", ".markdown"} or mime == "text/markdown" else "text"
        blocks = _text_blocks(raw.decode("utf-8-sig", errors="replace"), prefix)
    elif suffix in {".html", ".htm"} or mime in {"text/html", "application/xhtml+xml"}:
        blocks = _html_blocks(raw.decode("utf-8-sig", errors="replace"))
    elif suffix == ".pdf" or mime == "application/pdf":
        blocks = _pdf_blocks(path)
    elif suffix == ".docx" or mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        blocks = _docx_blocks(path)
    else:
        raise RagWorkerError(
            f"Unsupported source format for {path.name}; expected txt, md, html, pdf, or docx"
        )

    if not blocks:
        raise RagWorkerError(f"No extractable text found in {path.name}")
    return raw, blocks


def make_chunks(
    blocks: Sequence[ParsedBlock],
    identity: SourceIdentity,
    source_hash: str,
    *,
    chunk_words: int,
    chunk_overlap: int,
) -> list[RagChunk]:
    chunks: list[RagChunk] = []
    for block in blocks:
        words = block.text.split()
        start = 0
        while start < len(words):
            end = min(start + chunk_words, len(words))
            passage = " ".join(words[start:end])
            locator = f"{block.locator};words:{start + 1}-{end}"
            content_hash = hashlib.sha256(passage.encode("utf-8")).hexdigest()
            identity_material = "\x1f".join(
                [
                    identity.case_id,
                    identity.corpus,
                    identity.source_id,
                    source_hash,
                    locator,
                    content_hash,
                ]
            )
            point_id = str(uuid.uuid5(POINT_NAMESPACE, identity_material))
            chunks.append(
                RagChunk(
                    point_id=point_id,
                    chunk_index=len(chunks),
                    locator=locator,
                    passage=passage,
                    content_hash=content_hash,
                )
            )
            if end == len(words):
                break
            start = end - chunk_overlap
    if not chunks:
        raise RagWorkerError("Source produced no indexable chunks")
    return chunks


class EmbeddingEngine:
    def __init__(self, config: RagConfig) -> None:
        self.config = config
        self.mode = "fastembed"
        self._model: Any = None

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if self._model is None:
            try:
                from fastembed import TextEmbedding
            except ImportError as exc:
                raise RagWorkerError(
                    "FastEmbed is not installed; install server/rag/requirements.txt"
                ) from exc
            self.config.model_cache_path.mkdir(parents=True, exist_ok=True)
            self._model = TextEmbedding(
                model_name=self.config.embedding_model,
                cache_dir=str(self.config.model_cache_path),
            )
        try:
            return [vector.tolist() for vector in self._model.embed(list(texts))]
        except Exception as exc:
            raise RagWorkerError(f"FastEmbed failed: {exc}") from exc


def _payload(
    identity: SourceIdentity,
    source_hash: str,
    chunk: RagChunk,
    metadata: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "case_id": identity.case_id,
        "corpus": identity.corpus,
        "source_id": identity.source_id,
        "source_label": identity.source_label,
        "source_hash": source_hash,
        "content_hash": chunk.content_hash,
        "chunk_index": chunk.chunk_index,
        "locator": chunk.locator,
        "passage": chunk.passage,
        "metadata": dict(metadata),
    }


def _payload_matches(
    payload: Mapping[str, Any],
    case_id: str,
    corpus: str,
    source_ids: Sequence[str] | None,
) -> bool:
    if payload.get("case_id") != case_id or payload.get("corpus") != corpus:
        return False
    return not source_ids or payload.get("source_id") in source_ids


class QdrantLocalStore:
    backend = "qdrant-local"

    def __init__(self, config: RagConfig) -> None:
        try:
            from qdrant_client import QdrantClient, models
        except ImportError as exc:
            raise RagWorkerError(
                "qdrant-client is not installed; install server/rag/requirements.txt"
            ) from exc
        config.store_path.mkdir(parents=True, exist_ok=True)
        self.config = config
        self.models = models
        try:
            self.client = QdrantClient(path=str(config.store_path))
        except Exception as exc:
            raise RagWorkerError(f"Unable to open Qdrant local store: {exc}") from exc

    def is_ready(self) -> bool:
        try:
            return bool(self.client.collection_exists(self.config.collection_name))
        except Exception:
            return False

    def _filter(
        self,
        case_id: str,
        corpus: str,
        source_ids: Sequence[str] | None = None,
    ) -> Any:
        must = [
            self.models.FieldCondition(key="case_id", match=self.models.MatchValue(value=case_id)),
            self.models.FieldCondition(key="corpus", match=self.models.MatchValue(value=corpus)),
        ]
        if source_ids:
            must.append(
                self.models.FieldCondition(
                    key="source_id", match=self.models.MatchAny(any=list(source_ids))
                )
            )
        return self.models.Filter(must=must)

    def _ensure_collection(self, dimension: int) -> None:
        if self.is_ready():
            return
        self.client.create_collection(
            collection_name=self.config.collection_name,
            vectors_config=self.models.VectorParams(
                size=dimension,
                distance=self.models.Distance.COSINE,
            ),
        )

    def count_source(self, identity: SourceIdentity) -> int:
        if not self.is_ready():
            return 0
        result = self.client.count(
            collection_name=self.config.collection_name,
            count_filter=self._filter(identity.case_id, identity.corpus, [identity.source_id]),
            exact=True,
        )
        return int(result.count)

    def delete_source(self, identity: SourceIdentity) -> int:
        count = self.count_source(identity)
        if count:
            self.client.delete(
                collection_name=self.config.collection_name,
                points_selector=self.models.FilterSelector(
                    filter=self._filter(identity.case_id, identity.corpus, [identity.source_id])
                ),
                wait=True,
            )
        return count

    def upsert(self, rows: Sequence[tuple[str, list[float], dict[str, Any]]]) -> None:
        if not rows:
            return
        self._ensure_collection(len(rows[0][1]))
        batch_size = 128
        for start in range(0, len(rows), batch_size):
            points = [
                self.models.PointStruct(id=point_id, vector=vector, payload=payload)
                for point_id, vector, payload in rows[start : start + batch_size]
            ]
            self.client.upsert(
                collection_name=self.config.collection_name,
                points=points,
                wait=True,
            )

    def query(
        self,
        vector: list[float],
        *,
        case_id: str,
        corpus: str,
        source_ids: Sequence[str] | None,
        limit: int,
        score_threshold: float | None,
    ) -> list[tuple[str, float, dict[str, Any]]]:
        if not self.is_ready():
            return []
        query_filter = self._filter(case_id, corpus, source_ids)
        kwargs: dict[str, Any] = {
            "collection_name": self.config.collection_name,
            "query_filter": query_filter,
            "limit": limit,
            "with_payload": True,
        }
        if score_threshold is not None:
            kwargs["score_threshold"] = score_threshold
        try:
            response = self.client.query_points(query=vector, **kwargs)
            points = response.points
        except AttributeError:
            points = self.client.search(query_vector=vector, **kwargs)
        rows = [
            (str(point.id), float(point.score), dict(point.payload or {}))
            for point in points
        ]
        rows.sort(key=lambda item: (-item[1], item[0]))
        return rows

    def close(self) -> None:
        close = getattr(self.client, "close", None)
        if callable(close):
            close()


def _make_store(config: RagConfig) -> QdrantLocalStore:
    return QdrantLocalStore(config)


def _citation(point_id: str, score: float, payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "citationId": point_id,
        "caseId": str(payload["case_id"]),
        "corpus": str(payload["corpus"]),
        "sourceId": str(payload["source_id"]),
        "sourceLabel": str(payload["source_label"]),
        "sourceHash": str(payload["source_hash"]),
        "contentHash": str(payload["content_hash"]),
        "chunkIndex": int(payload["chunk_index"]),
        "locator": str(payload["locator"]),
        "passage": str(payload["passage"]),
        "score": score,
        "metadata": dict(payload.get("metadata") or {}),
    }


def _upsert(
    request: Mapping[str, Any],
    config: RagConfig,
    *,
    raw_bytes: bytes,
    blocks: Sequence[ParsedBlock],
) -> dict[str, Any]:
    identity = _identity(request)
    metadata = _metadata(request)
    source_hash = hashlib.sha256(raw_bytes).hexdigest()
    chunks = make_chunks(
        blocks,
        identity,
        source_hash,
        chunk_words=config.chunk_words,
        chunk_overlap=config.chunk_overlap,
    )
    engine = EmbeddingEngine(config)
    vectors = engine.embed([chunk.passage for chunk in chunks])
    if len(vectors) != len(chunks):
        raise RagWorkerError("Embedding engine returned the wrong number of vectors")
    rows = [
        (chunk.point_id, vector, _payload(identity, source_hash, chunk, metadata))
        for chunk, vector in zip(chunks, vectors)
    ]
    store = _make_store(config)
    try:
        replaced = store.delete_source(identity)
        store.upsert(rows)
    finally:
        store.close()
    return {
        "caseId": identity.case_id,
        "corpus": identity.corpus,
        "sourceId": identity.source_id,
        "sourceLabel": identity.source_label,
        "sourceHash": source_hash,
        "indexedChunks": len(chunks),
        "replacedChunks": replaced,
        "embeddingMode": engine.mode,
    }


def handle_request(request: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(request, Mapping):
        raise RagWorkerError("Request must be a JSON object")
    action = _required_string(request, "action", max_length=64)
    config = RagConfig.from_request(request.get("config") if isinstance(request.get("config"), Mapping) else None)

    if action == "health":
        return {
            "backend": "qdrant-local",
            "storePath": str(config.store_path),
            "collectionName": config.collection_name,
            "embeddingMode": "fastembed",
            "embeddingModel": config.embedding_model,
            "qdrantAvailable": importlib.util.find_spec("qdrant_client") is not None,
            "fastembedAvailable": importlib.util.find_spec("fastembed") is not None,
        }

    if action == "upsert_file":
        path = Path(_required_string(request, "file_path", max_length=32_768)).expanduser().resolve()
        raw, blocks = parse_document(path, str(request.get("mime_type") or "") or None)
        return _upsert(request, config, raw_bytes=raw, blocks=blocks)

    if action == "upsert_text":
        text = _required_string(request, "text", max_length=20_000_000)
        prefix = str(request.get("locator_prefix") or "text").strip() or "text"
        blocks = _text_blocks(text, prefix)
        if not blocks:
            raise RagWorkerError("Text source contains no extractable text")
        return _upsert(request, config, raw_bytes=text.encode("utf-8"), blocks=blocks)

    if action == "delete_source":
        identity = _identity(request, require_label=False)
        store = _make_store(config)
        try:
            deleted = store.delete_source(identity)
        finally:
            store.close()
        return {
            "caseId": identity.case_id,
            "corpus": identity.corpus,
            "sourceId": identity.source_id,
            "deletedChunks": deleted,
        }

    if action == "query":
        case_id = _required_string(request, "case_id", max_length=128)
        corpus = _required_string(request, "corpus", max_length=128)
        query_text = _required_string(request, "query", max_length=100_000)
        limit = int(request.get("limit") or 8)
        if limit < 1 or limit > 100:
            raise RagWorkerError("limit must be between 1 and 100")
        threshold_raw = request.get("score_threshold")
        score_threshold = float(threshold_raw) if threshold_raw is not None else None
        source_ids_raw = request.get("source_ids")
        source_ids: list[str] | None = None
        if source_ids_raw is not None:
            if not isinstance(source_ids_raw, list):
                raise RagWorkerError("source_ids must be an array")
            source_ids = [str(item).strip() for item in source_ids_raw if str(item).strip()]
            if not source_ids:
                return {
                    "matches": [],
                    "embeddingMode": "fastembed",
                }

        store = _make_store(config)
        try:
            if not store.is_ready():
                matches: list[tuple[str, float, dict[str, Any]]] = []
            else:
                vector = EmbeddingEngine(config).embed([query_text])[0]
                matches = store.query(
                    vector,
                    case_id=case_id,
                    corpus=corpus,
                    source_ids=source_ids,
                    limit=limit,
                    score_threshold=score_threshold,
                )
        finally:
            store.close()
        return {
            "matches": [_citation(point_id, score, payload) for point_id, score, payload in matches],
            "embeddingMode": "fastembed",
        }

    raise RagWorkerError(f"Unknown action: {action}")


def main() -> None:
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            raise RagWorkerError("Expected one JSON request on stdin")
        request = json.loads(raw)
        result = handle_request(request)
        envelope = {"ok": True, "result": result}
    except Exception as exc:
        envelope = {
            "ok": False,
            "error": {
                "code": exc.__class__.__name__,
                "message": str(exc),
            },
        }
    sys.stdout.write(json.dumps(envelope, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
