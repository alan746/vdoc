"""QA-only conservative repair of null ToUnicode entries using existing ActualText.
No OCR, source-text guessing, glyph/layout changes, or ambiguous substitutions.
Only simple fixed-width ToUnicode CMaps are supported. Unsupported input fails closed.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DecodedStreamObject, NameObject, TextStringObject, ByteStringObject


def residual(actual, known):
    """Return the unique remainder after deleting known codepoints in any order."""
    required = Counter(known)
    if len(actual) > 64 or required - Counter(actual):
        raise ValueError('ActualText cannot uniquely account for known glyphs')
    states = {(tuple(sorted(required.items())), '')}
    for char in actual:
        next_states = set()
        for remaining, kept in states:
            counts = dict(remaining)
            next_states.add((remaining, kept + char))
            if counts.get(char, 0):
                counts[char] -= 1
                if not counts[char]:
                    del counts[char]
                next_states.add((tuple(sorted(counts.items())), kept))
        states = next_states
        if len(states) > 4096:
            raise ValueError('ActualText search limit exceeded')
    answers = {kept for counts, kept in states if not counts}
    if len(answers) != 1:
        raise ValueError('Ambiguous ActualText remainder')
    value = answers.pop()
    if not value or '\x00' in value or '\ufffd' in value:
        raise ValueError('Invalid replacement Unicode')
    return value


def cmap(font):
    stream = font.get('/ToUnicode')
    if stream is None:
        raise ValueError('Text font has no ToUnicode CMap')
    source = stream.get_object().get_data().decode('ascii')
    spaces = re.findall(r'begincodespacerange\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*endcodespacerange', source)
    if len(spaces) != 1 or len(spaces[0][0]) != len(spaces[0][1]):
        raise ValueError('Unsupported variable-width CMap')
    width = len(spaces[0][0]) // 2
    mappings = {}
    for block in re.findall(r'beginbfchar(.*?)endbfchar', source, re.S):
        for code, value in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            mappings[int(code, 16)] = bytes.fromhex(value).decode('utf-16-be')
    for block in re.findall(r'beginbfrange(.*?)endbfrange', source, re.S):
        if '[' in block:
            raise ValueError('Array bfrange unsupported')
        for lo, hi, value in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            start, end, first = int(lo, 16), int(hi, 16), int(value, 16)
            if end - start > 65535:
                raise ValueError('CMap range limit')
            for code in range(start, end + 1):
                mappings[code] = (first + code - start).to_bytes(len(value) // 2, 'big').decode('utf-16-be')
    return source, width, mappings


def repair(input_path, output_path, logical_order=False):
    if output_path.exists():
        raise ValueError('Refuse to overwrite output')
    reader = PdfReader(input_path)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    fonts, totals, covered, proposals = {}, Counter(), Counter(), defaultdict(set)
    all_usage = Counter()
    spans = []
    for page in writer.pages:
        resources = page['/Resources']
        if any(x.get_object().get('/Subtype') == '/Form' for x in resources.get('/XObject', {}).values()):
            raise ValueError('Form XObjects require recursive coverage; unsupported')
        local_fonts = {}
        for name, ref in resources.get('/Font', {}).items():
            font = ref.get_object()
            key = ref.idnum
            if key not in fonts:
                source, width, mapping = cmap(font)
                fonts[key] = (font, source, width, mapping)
            local_fonts[name] = key
        current = None
        graphics = []
        marked = []
        for args, op in ContentStream(page.get_contents(), writer).operations:
            if op == b'q':
                graphics.append(current)
            elif op == b'Q':
                current = graphics.pop()
            elif op == b'Tf':
                current = local_fonts[args[0]]
            elif op in (b'BDC', b'BMC'):
                value = args[1].get('/ActualText') if op == b'BDC' and isinstance(args[1], dict) else None
                if value is not None and any(x is not None for x in marked):
                    raise ValueError('Nested ActualText unsupported')
                marked.append({'actual': str(value), 'glyphs': []} if value is not None else None)
            elif op == b'EMC':
                span = marked.pop()
                if span is not None:
                    spans.append(span)
            elif op in (b'Tj', b'TJ', b"'", b'"'):
                if current is None:
                    raise ValueError('Text without font')
                values = args[0] if op == b'TJ' else [args[-1]]
                for value in values:
                    if not isinstance(value, (TextStringObject, ByteStringObject)):
                        continue
                    raw = value.original_bytes if isinstance(value, TextStringObject) else bytes(value)
                    width, mapping = fonts[current][2:]
                    if len(raw) % width:
                        raise ValueError('Partial encoded glyph')
                    for offset in range(0, len(raw), width):
                        code = int.from_bytes(raw[offset:offset + width], 'big')
                        unicode = mapping.get(code)
                        unknown = unicode is None or '\x00' in unicode or '\ufffd' in unicode
                        key = (current, code)
                        all_usage[key] += 1
                        if unknown:
                            totals[key] += 1
                        for span in marked:
                            if span is not None:
                                span['glyphs'].append((key, unicode, unknown))
        if marked:
            raise ValueError('Unclosed marked content')
    for span in spans:
        if logical_order:
            glyphs, actual = span['glyphs'], span['actual']
            decoded = ''.join(g[1] or '\x00' for g in glyphs)
            if unicodedata.normalize('NFKC', decoded) == unicodedata.normalize('NFKC', actual):
                continue
            if not actual or '\x00' in actual or '\ufffd' in actual or not 0 < len(glyphs) <= len(actual) <= 64:
                raise ValueError('ActualText requires ambiguous or empty glyph mappings')
            for index, (key, prior, _) in enumerate(glyphs):
                value = actual[index:] if index == len(glyphs) - 1 else actual[index]
                if value != prior:
                    proposals[key].add(value)
                    covered[key] += 1
            continue
        unknown = [g for g in span['glyphs'] if g[2]]
        if not unknown:
            continue
        if len(unknown) != 1:
            raise ValueError('ActualText has more than one unmapped glyph')
        key = unknown[0][0]
        known = ''.join(g[1] for g in span['glyphs'] if not g[2])
        proposals[key].add(residual(span['actual'], known))
        covered[key] += 1
    if logical_order:
        if any(all_usage[key] != covered[key] for key in proposals) or any(key not in proposals for key in totals):
            raise ValueError('Changed glyph has unaccounted use outside matching ActualText')
    elif totals != covered:
        raise ValueError('Unmapped glyph used outside a uniquely resolved ActualText span')
    edits = []
    for key, values in proposals.items():
        if len(values) != 1:
            raise ValueError('Conflicting mapping for reused glyph')
        font_id, code = key
        font, source, width, mapping = fonts[font_id]
        if mapping.get(code) is None or (not logical_order and mapping.get(code) not in ('\x00', '\ufffd')):
            raise ValueError('Only explicit null/replacement mappings may be edited')
        replacement = next(iter(values))
        token = f'{code:0{width * 2}X}'
        prior_hex = mapping[code].encode('utf-16-be').hex().upper()
        pattern = rf'(<{token}>\s*)<{prior_hex}>'
        source, count = re.subn(pattern, lambda m: m[1] + '<' + replacement.encode('utf-16-be').hex().upper() + '>', source, flags=re.I)
        if count != 1:
            raise ValueError('Null mapping not represented by a unique bfchar')
        fonts[font_id] = (font, source, width, mapping)
        edits.append({'fontObject': font_id, 'glyphHex': token, 'unicode': replacement, 'coveredOccurrences': covered[key]})
    for font_id in {key[0] for key in proposals}:
        font, source, _, _ = fonts[font_id]
        stream = DecodedStreamObject()
        stream.set_data(source.encode('ascii'))
        font[NameObject('/ToUnicode')] = writer._add_object(stream)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open('xb') as output:
        writer.write(output)
    return {'input': str(input_path), 'output': str(output_path), 'inputSha256': hashlib.sha256(input_path.read_bytes()).hexdigest(), 'outputSha256': hashlib.sha256(output_path.read_bytes()).hexdigest(), 'edits': edits, 'pages': len(writer.pages), 'logicalOrder': logical_order, 'scope': 'ToUnicode bfchar values derived from existing ActualText. Every changed glyph occurrence must be covered and agree. Rendering operators and font glyph data unchanged. QA only.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--logical-order', action='store_true')
    args = parser.parse_args()
    report = repair(args.input, args.output, args.logical_order)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))
