"""Synthetic parser/deletion regression tests; never opens application data."""
import io
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from server.rag import worker


class WorkerBudgetTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="prisonbreak-worker-test-")
        self.root = Path(self.scratch.name)

    def tearDown(self):
        self.scratch.cleanup()

    def docx(self, text, *, name="source.docx", xml=None, compression=zipfile.ZIP_DEFLATED):
        path = self.root / name
        if xml is None:
            xml = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                   '<w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:body></w:document>').encode()
        with zipfile.ZipFile(path, "w", compression=compression) as archive:
            archive.writestr("word/document.xml", xml)
        return path

    def test_small_legitimate_documents_keep_text_and_locators(self):
        raw, blocks = worker.parse_document(self.docx("Synthetic hearing record dated May 1."))
        self.assertTrue(raw)
        self.assertEqual(blocks[0].locator, "docx:paragraph:1")
        self.assertEqual(blocks[0].text, "Synthetic hearing record dated May 1.")
        for suffix, text in [(".txt", "Synthetic text record."), (".md", "Synthetic markdown record."), (".html", "<p>Synthetic HTML record.</p><script>ignored</script>")]:
            path = self.root / ("source" + suffix)
            path.write_text(text)
            _, extracted = worker.parse_document(path)
            self.assertTrue(extracted)
            self.assertNotIn("ignored", " ".join(block.text for block in extracted))

    def test_compressed_docx_rejected_before_xml_parser(self):
        path = self.docx("A" * 1_000_000)
        self.assertLess(path.stat().st_size, 2500)
        with patch.object(worker.ElementTree, "fromstring", side_effect=AssertionError("must not parse")):
            with self.assertRaisesRegex(worker.RagWorkerError, "compression-ratio"):
                worker.parse_document(path)

    def test_docx_dtd_and_deep_xml_rejected(self):
        dtd = b'<!DOCTYPE x [<!ENTITY a "expanded">]><x>&a;</x>'
        with self.assertRaisesRegex(worker.RagWorkerError, "DTD"):
            worker.parse_document(self.docx("", xml=dtd))
        deep = ("<a>" * 130 + "x" + "</a>" * 130).encode()
        with self.assertRaisesRegex(worker.RagWorkerError, "structure"):
            worker.parse_document(self.docx("", xml=deep))

    def test_raw_file_text_blocks_and_chunk_limits(self):
        path = self.root / "oversized.txt"
        with path.open("wb") as stream:
            stream.truncate(worker.MAX_FILE_BYTES + 1)
        with self.assertRaisesRegex(worker.RagWorkerError, "bytes"):
            worker.parse_document(path)
        with self.assertRaisesRegex(worker.RagWorkerError, "characters"):
            worker._text_blocks("x" * (worker.MAX_TEXT_CHARACTERS + 1))
        with self.assertRaisesRegex(worker.RagWorkerError, "text blocks"):
            worker._html_blocks("<p>x</p>" * (worker.MAX_BLOCKS + 1))
        identity = worker.SourceIdentity("1", "case", "synthetic", "synthetic.txt")
        with self.assertRaisesRegex(worker.RagWorkerError, "chunks"):
            worker.make_chunks([worker.ParsedBlock("text:1", "word " * 5010)], identity, "hash", chunk_words=4, chunk_overlap=3)

    def test_upsert_text_shares_budget_before_embedding_or_store(self):
        with patch.object(worker, "_make_store", side_effect=AssertionError("must not open storage")), patch.object(worker, "EmbeddingEngine", side_effect=AssertionError("must not embed")):
            with self.assertRaisesRegex(worker.RagWorkerError, "characters"):
                worker.handle_request({"action": "upsert_text", "text": "x" * (worker.MAX_TEXT_CHARACTERS + 1)})

    def test_pdf_page_and_decoder_limits(self):
        from pypdf import PdfWriter, filters
        path = self.root / "pages.pdf"
        writer = PdfWriter()
        for _ in range(worker.MAX_PDF_PAGES + 1):
            writer.add_blank_page(width=72, height=72)
        writer.write(str(path))
        with self.assertRaisesRegex(worker.RagWorkerError, "pages"):
            worker._pdf_blocks(path)
        self.assertEqual(filters.ZLIB_MAX_OUTPUT_LENGTH, worker.MAX_XML_BYTES)
        import zlib
        with self.assertRaises(Exception):
            filters.decompress(zlib.compress(b"a" * (worker.MAX_XML_BYTES + 1)))

    def test_legitimate_pdf_text_and_locator_survive(self):
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
        path = self.root / "text.pdf"
        writer = PdfWriter()
        page = writer.add_blank_page(width=300, height=300)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 20 20 Td (Synthetic PDF hearing record.) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream.flate_encode())
        writer.write(str(path))
        _, blocks = worker.parse_document(path)
        self.assertEqual(blocks, [worker.ParsedBlock("pdf:page:1", "Synthetic PDF hearing record.")])

    def test_pdf_aggregate_stream_budget(self):
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
        path = self.root / "expanded.pdf"
        writer = PdfWriter()
        for index in range(5):
            page = writer.add_blank_page(width=72, height=72)
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject()})
            stream = DecodedStreamObject()
            stream.set_data(f"% synthetic page {index}\n".encode() + b" " * 100)
            page[NameObject("/Contents")] = writer._add_object(stream.flate_encode())
        writer.write(str(path))
        self.assertLess(path.stat().st_size, worker.MAX_FILE_BYTES)
        with patch.object(worker, "MAX_PDF_EXPANDED_BYTES", 400):
            with self.assertRaisesRegex(worker.RagWorkerError, "aggregate"):
                worker._pdf_blocks(path)

    def test_deletion_mandates_valid_case_before_opening_store(self):
        with patch.object(worker, "_make_store", side_effect=AssertionError("must not open storage")):
            for action in ("delete_case", "delete_corpus"):
                for case_id in (None, "", 0, -1, "*", "1.5", "9007199254740992"):
                    with self.assertRaises(worker.RagWorkerError):
                        worker.handle_request({"action": action, "case_id": case_id, "corpus": "case"})

    def test_real_qdrant_case_and_corpus_deletion_are_scoped_and_idempotent(self):
        config = worker.RagConfig.from_request({"store_path": str(self.root / "qdrant"), "model_cache_path": str(self.root / "cache")})
        store = worker.QdrantLocalStore(config)
        try:
            rows = []
            for case_id, corpus in [("1", "case"), ("1", "research:laws:old"), ("1", "research:laws:orphan"), ("2", "case")]:
                rows.append((str(uuid.uuid4()), [0.5, 0.5], {"case_id": case_id, "corpus": corpus, "source_id": "synthetic"}))
            store.upsert(rows)
            self.assertEqual(store.delete_scope("1", "research:laws:old"), 1)
            self.assertEqual(store.delete_scope("1", "research:laws:old"), 0)
            self.assertEqual(store.delete_scope("1"), 2)
            self.assertEqual(store.delete_scope("1"), 0)
            self.assertEqual(store.count_source(worker.SourceIdentity("2", "case", "synthetic", "fixture")), 1)
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
