"""QA-only standard marked-content control; preserve every drawing operator."""
import hashlib
import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, NameObject

HERE = Path(__file__).parent
for ordering in ("source", "page"):
    baseline = Path(f"output/pdf/type0-minimal-20261011/hebrew-{ordering}-visual.pdf")
    target = Path(f"output/pdf/reversed-chars-20261011/hebrew-{ordering}-reversed.pdf")
    reader = PdfReader(baseline)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    page = writer.pages[0]
    original = list(page.get_contents().operations)
    wrapped = []
    line = 0
    for operands, operator in original:
        if operator == b"BT":
            line += 1
            if line > 1:
                wrapped.append(([NameObject("/ReversedChars")], b"BMC"))
        wrapped.append((operands, operator))
        if operator == b"ET" and line > 1:
            wrapped.append(([], b"EMC"))
    assert line == 3
    stream = ContentStream(None, writer)
    stream.operations = wrapped
    page.replace_contents(stream)
    if not target.exists():
        with target.open("xb") as output:
            writer.write(output)
    result = PdfReader(target)
    unwrapped = [(args, op) for args, op in result.pages[0].get_contents().operations if op not in (b"BMC", b"EMC")]
    # Compare canonical PDF serialization, not binary floating point objects.
    before = ContentStream(None, writer)
    before.operations = original
    after = ContentStream(None, writer)
    after.operations = unwrapped
    assert before.get_data() == after.get_data()
    assert sum(op == b"BMC" and args == [NameObject("/ReversedChars")] for args, op in result.pages[0].get_contents().operations) == 2
    report = json.loads(Path(f"tests/fixtures/pdf-type0-minimal-20261011/hebrew-{ordering}-visual.json").read_text())
    report.update(file=str(target), mode=ordering + "-reversed", baseline=str(baseline), baselineSha256=hashlib.sha256(baseline.read_bytes()).hexdigest(), sha256=hashlib.sha256(target.read_bytes()).hexdigest(), drawingOperatorsSerializationUnchanged=True, reversedSequences=2)
    with (HERE / f"hebrew-{ordering}-reversed.json").open("x") as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
    print(target)
