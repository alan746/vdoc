"""Verify the fixed B acceptance fixture's actual PDF, not CSS or preview DOM.
This fixture-specific oracle does not certify arbitrary documents or all glyph shapes.
Requires pypdf and pdfplumber. Usage: verify-acceptance.py PDF --report JSON
"""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path
import argparse, hashlib, json, logging, re, unicodedata
from collections import Counter
from pathlib import Path
import pdfplumber
from pypdf import PdfReader


def verify(path, require_logical_hindi=False):
    reader = PdfReader(path)
    failures = []
    pages = []
    expected_rows = [range(1, 9), range(9, 21), range(21, 33), range(33, 37), range(0)]
    if len(reader.pages) != 5:
        failures.append(f'Expected 5 pages; found {len(reader.pages)}')
    with pdfplumber.open(path) as pdf:
        for index, page in enumerate(pdf.pages):
            text = reader.pages[index].extract_text() or ''
            rows = re.findall(r'ROW\s+(\d{2})', text)
            expected = [f'{n:02}' for n in expected_rows[index]] if index < 5 else []
            hindi = ''.join(c for c in unicodedata.normalize('NFC', text) if '\u0900' <= c <= '\u097f')
            hindi_expected = Counter('हिन्दी' * sum(int(n) % 2 == 0 for n in expected))
            # Inventory is independent of PDF font type and visual appearance.
            # Safari can keep drawing glyphs while dropping their searchable text.
            normalized = unicodedata.normalize('NFKC', text)
            pairs = sum(int(n) % 2 == 0 for n in expected)
            cjk_expected = ('中文' + ('中文' if expected else '')
                            + '中文日本語' * pairs + '中文日本語' * pairs
                            + ('中文输入测试' if index == 0 else '')
                            + ('中文' if index == 4 else ''))
            script_checks = {
                'cjk': (''.join(c for c in normalized if '\u3400' <= c <= '\u9fff'), cjk_expected),
                'arabic': (''.join(c for c in normalized if '\u0600' <= c <= '\u06ff'), 'العربية' * (pairs + bool(expected))),
                'hebrew': (''.join(c for c in normalized if '\u0590' <= c <= '\u05ff'), 'עברית' * pairs),
            }
            checks = {
                'rowsOnExpectedPage': rows == expected,
                'headerOnce': text.count('VDoc system acceptance') == 1,
                'footerOnce': text.count('Local document acceptance') == 1,
                'pageNumberOnce': len(re.findall(rf'(?<!\d){index + 1}\s*/\s*5(?!\d)', text)) == 1,
                'finalHeadingOnLastPage': text.count('FINAL PAGE CHECK') == (1 if index == 4 else 0),
                'finalBodyOnLastPage': text.count('End of acceptance sample.') == (1 if index == 4 else 0),
                'tableEndOnFourthPage': text.count('TABLE END') == (1 if index == 3 else 0),
                'selectableText': len(page.chars) > 50,
                'hindiCodepointsPreserved': Counter(hindi) == hindi_expected,
                'noUnmappedCharacters': '\x00' not in text and '\ufffd' not in text,
                'imagePresentOnFirstPage': index != 0 or len(page.images) > 0,
                'noTextOutsidePage': all(c['x0'] >= -.1 and c['x1'] <= page.width + .1 and c['top'] >= -.1 and c['bottom'] <= page.height + .1 for c in page.chars),
            }
            checks.update({name + 'CodepointsPreserved': Counter(actual) == Counter(wanted)
                           for name, (actual, wanted) in script_checks.items()})
            if require_logical_hindi:
                checks['logicalHindiOrder'] = unicodedata.normalize('NFC', text).count('हिन्दी') == sum(int(n) % 2 == 0 for n in expected)
            failures.extend(f'Page {index + 1}: {name}' for name, ok in checks.items() if not ok)
            pages.append({'page': index + 1, 'rows': rows, 'checks': checks,
                          'scriptInventory': {name: {'actual': len(actual), 'expected': len(wanted)}
                                              for name, (actual, wanted) in script_checks.items()}})
    return {'fixture': str(qa_path('safari-preview/source.vdoc.json')), 'file': str(path.resolve()), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'requireLogicalHindi': require_logical_hindi, 'passed': not failures, 'failures': failures, 'pages': pages, 'limits': 'Fixture-specific structural/text/geometry check; visual review remains required for glyph shaping, borders, image fidelity and clipping.'}

if __name__ == '__main__':
    logging.getLogger('pypdf').setLevel(logging.ERROR)
    logging.getLogger('pdfminer').setLevel(logging.ERROR)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--require-logical-hindi', action='store_true')
    args = parser.parse_args()
    result = verify(args.pdf, args.require_logical_hindi)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({'passed': result['passed'], 'failures': result['failures']}))
    raise SystemExit(0 if result['passed'] else 1)
