# Word divider round trip — 2026-10-09

Independent samples; existing documents were not edited.

- Source: `source.vdoc.json`, imported through the homepage chooser.
- Source ID `a9729ec5-0dac-4dba-97ad-f3d73781ea80`, title `QA divider roundtrip 2026-10-09`.
- Actual download: `downloaded.docx`, 10414 bytes, SHA-256 `93ff90ec0275f07af0310d238fe7e1f9d44ad27553c132395c97286ebfa4c0d7`.
- Reimport ID `5fb399a4-6563-4a76-9afe-eb5dae986966`, renamed `QA divider Word reimport 2026-10-09`.
- Both samples moved to `QA · Local workspace`.

Downloaded DOCX contains three VDocDivider paragraphs and one VDocListDivider0 paragraph. The actual file was imported through the homepage chooser. DOM verified four horizontal rules, one inside the original list item and one inside the merged cell (colspan=2); all body/start/end text remained present.

The source full JSON was unchanged after export. After capturing the reimport full JSON, the first rule was selected by clicking it and deleted with Backspace: four rules became three. Toolbar Undo restored the exact full JSON. Saved locally was confirmed, then refresh preserved the exact full JSON again.

Tests additionally cover adjacent/end dividers, following empty paragraph formatting, bullet/ordered/nested list continuation, adjacent page breaks and two round trips, ordinary bordered paragraphs, and external text added to the private divider style. This does not claim arbitrary external Word horizontal-line detection, desktop Word visual fidelity or native Safari acceptance.
