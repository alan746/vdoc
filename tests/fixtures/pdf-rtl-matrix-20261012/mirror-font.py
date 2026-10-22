"""QA transform: reflect outlines within their advances and rename the derived font."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tmp/pdf-engine-evaluation/site'))
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

source = Path('tests/fixtures/browser-pdf-20261011/fonts/NotoSansHebrew-static.ttf')
target = Path('tests/fixtures/pdf-rtl-matrix-20261012/VDocQAMirrored.ttf')
assert not target.exists()
font = TTFont(source)
glyphset = font.getGlyphSet()
new_glyphs = {}
for name in font.getGlyphOrder():
    advance, _ = font['hmtx'][name]
    recording = DecomposingRecordingPen(glyphset)
    glyphset[name].draw(recording)
    pen = TTGlyphPen(None)
    recording.replay(TransformPen(pen, (-1, 0, 0, 1, advance, 0)))
    new_glyphs[name] = pen.glyph()
for name, glyph in new_glyphs.items():
    font['glyf'][name] = glyph
    glyph.recalcBounds(font['glyf'])
    advance, _ = font['hmtx'][name]
    font['hmtx'][name] = (advance, getattr(glyph, 'xMin', 0))
for record in font['name'].names:
    if record.nameID in (1, 3, 4, 6, 16):
        record.string = ('VDocQAMirrored' if record.nameID == 6 else 'VDoc QA Mirrored').encode(record.getEncoding())
font.save(target)
print(target)
