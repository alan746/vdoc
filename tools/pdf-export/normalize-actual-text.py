"""QA-only ActualText compatibility normalization without changing visible glyphs.
Use per-occurrence font aliases so glyphs reused in other contexts keep their mappings.
Unsupported/ambiguous structures fail before writing. No invisible text or OCR is added.
"""
import argparse, hashlib, importlib.util, json, unicodedata
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ByteStringObject, ContentStream, DecodedStreamObject, DictionaryObject, NameObject, TextStringObject
spec = importlib.util.spec_from_file_location('unicode_repair', Path(__file__).with_name('repair-unicode.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def normalize(source_path, target_path):
    if target_path.exists():
        raise ValueError('Refuse to overwrite output')
    reader = PdfReader(source_path)
    if reader.is_encrypted:
        raise ValueError('Encrypted PDFs unsupported')
    writer = PdfWriter(reader, incremental=True)
    plans, reports = [], []
    for page_number, page in enumerate(writer.pages, 1):
        resources = page['/Resources']
        if any(x.get_object().get('/Subtype') == '/Form' for x in resources.get('/XObject', {}).values()):
            raise ValueError('Form XObjects require recursive coverage; unsupported')
        fonts = {name: (ref.get_object(), helper.cmap(ref.get_object())) for name, ref in resources.get('/Font', {}).items()}
        ops = ContentStream(page.get_contents(), writer).operations
        current, stack, marked, spans = None, [], [], []
        for index, (args, op) in enumerate(ops):
            if op == b'q':
                stack.append(current)
            elif op == b'Q':
                current = stack.pop()
            elif op == b'Tf':
                current = (args[0], args[1])
            elif op in (b'BMC', b'BDC'):
                actual = args[1].get('/ActualText') if op == b'BDC' and isinstance(args[1], dict) else None
                if actual is not None and any(x is not None for x in marked):
                    raise ValueError('Nested ActualText unsupported')
                marked.append({'actual': str(actual), 'glyphs': []} if actual is not None else None)
            elif op == b'EMC':
                span = marked.pop()
                if span is not None:
                    spans.append(span)
            elif op in (b'Tj', b'TJ', b"'", b'"') and any(x is not None for x in marked):
                if op not in (b'Tj', b'TJ'):
                    raise ValueError('Quoted text operators within ActualText unsupported')
                name, size = current
                _, (_, width, mapping) = fonts[name]
                values = args[0] if op == b'TJ' else args
                for arg_index, value in enumerate(values):
                    if not isinstance(value, (TextStringObject, ByteStringObject)):
                        continue
                    raw = value.original_bytes if isinstance(value, TextStringObject) else bytes(value)
                    if len(raw) % width:
                        raise ValueError('Partial encoded glyph')
                    for offset in range(0, len(raw), width):
                        encoded = raw[offset:offset + width]
                        glyph = {'location': (index, arg_index, offset), 'font': name, 'size': size, 'encoded': encoded, 'unicode': mapping.get(int.from_bytes(encoded, 'big'), '\x00')}
                        for span in marked:
                            if span is not None:
                                span['glyphs'].append(glyph)
        if marked:
            raise ValueError('Unclosed marked content')
        edits = {}
        for span in spans:
            text, glyphs = span['actual'], span['glyphs']
            decoded = ''.join(g['unicode'] for g in glyphs)
            if unicodedata.normalize('NFKC', decoded) == unicodedata.normalize('NFKC', text):
                continue
            if not text or '\x00' in text or '\ufffd' in text or not 0 < len(glyphs) <= len(text) <= 64:
                raise ValueError('ActualText cannot be represented without empty glyph mappings')
            # Emit Unicode in semantic order; each alias is used only for this
            # encoded glyph and context. Original ActualText remains in place.
            for n, glyph in enumerate(glyphs):
                value = text[n:] if n == len(glyphs) - 1 else text[n]
                edits[glyph['location']] = (glyph, value)
            reports.append({'page': page_number, 'actual': text, 'previous': decoded, 'glyphCount': len(glyphs)})
        plans.append((page, fonts, ops, edits))
    for page, fonts, ops, edits in plans:
        if not edits:
            continue
        aliases, aliases_by_value = {}, {}
        font_resources = DictionaryObject(dict(page['/Resources']['/Font']))
        for location, (glyph, value) in edits.items():
            name, encoded = glyph['font'], glyph['encoded']
            key = (name, encoded, value)
            if key not in aliases_by_value:
                alias = NameObject('/VDU' + str(len(aliases_by_value) + 1))
                if alias in font_resources:
                    raise ValueError('Reserved alias already present')
                font = DictionaryObject(dict(fonts[name][0]))
                code, width = encoded.hex().upper(), len(encoded)
                cmap_name = 'VDoc-' + hashlib.sha256((str(name) + code + value).encode()).hexdigest()[:20]
                cmap = f'/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /{cmap_name} def\n/CMapType 2 def\n1 begincodespacerange\n<{"00" * width}> <{"FF" * width}>\nendcodespacerange\n1 beginbfchar\n<{code}> <{value.encode("utf-16-be").hex().upper()}>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
                stream = DecodedStreamObject()
                stream.set_data(cmap.encode('ascii'))
                font[NameObject('/ToUnicode')] = writer._add_object(stream)
                font_resources[alias] = writer._add_object(font)
                aliases_by_value[key] = alias
            aliases[location] = aliases_by_value[key]
        changed_ops, affected = [], {location[0] for location in edits}
        for index, (args, op) in enumerate(ops):
            if index not in affected:
                changed_ops.append((args, op))
                continue
            values = args[0] if op == b'TJ' else args
            for arg_index, value in enumerate(values):
                if not isinstance(value, (TextStringObject, ByteStringObject)):
                    changed_ops.append(([ArrayObject([value])], b'TJ'))
                    continue
                raw = value.original_bytes if isinstance(value, TextStringObject) else bytes(value)
                locations = sorted(loc for loc in edits if loc[:2] == (index, arg_index))
                start = 0
                for location in locations:
                    glyph, _ = edits[location]
                    offset = location[2]
                    if offset > start:
                        changed_ops.append(([ByteStringObject(raw[start:offset])], b'Tj'))
                    changed_ops.extend([([aliases[location], glyph['size']], b'Tf'), ([ByteStringObject(glyph['encoded'])], b'Tj'), ([glyph['font'], glyph['size']], b'Tf')])
                    start = offset + len(glyph['encoded'])
                if start < len(raw):
                    changed_ops.append(([ByteStringObject(raw[start:])], b'Tj'))
        resources = DictionaryObject(dict(page['/Resources']))
        resources[NameObject('/Font')] = font_resources
        page[NameObject('/Resources')] = resources
        content = ContentStream(None, writer)
        content.operations = changed_ops
        page[NameObject('/Contents')] = writer._add_object(content)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with target_path.open('xb') as out:
        writer.write(out)
    return {'input': str(source_path), 'output': str(target_path), 'pages': len(writer.pages), 'clusters': reports, 'inputSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(), 'outputSha256': hashlib.sha256(target_path.read_bytes()).hexdigest(), 'productionReady': False, 'scope': 'Uses existing ActualText only. Context-specific font aliases change Unicode maps, preserving glyph data, advances, layout, and ActualText. Unsupported structures rejected.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    report = normalize(args.input, args.output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'pages': report['pages'], 'clusters': len(report['clusters']), 'output': report['output']}))
