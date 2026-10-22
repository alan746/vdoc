# Long-title download verification — 2026-10-07

These files were actually downloaded from the in-app browser, then copied byte-for-byte from Downloads. They are not regenerated exporter fixtures. The independent QA source is `ccaaf28a-efe5-4938-8332-5bdc61910976`; its title was temporarily set to `('QA 导出标题 ').padEnd(120, '文')`, then restored. Its body was unchanged.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| downloaded.docx | 9799 | b9940434f1c1088dd44e0dba1a5201733fed78ceff48bfbbb9d292e2ad8ff172 |
| downloaded.vdoc.json | 2436 | 649449052e30ee8ef0bea57101474b7887189a4e01e544db4471c8aa38e72204 |

The browser shortened the long Chinese filenames to 243 UTF-8 bytes, retaining `.docx` and `.json` respectively. The JSON filename lost its intermediate `.vdoc` suffix, but the file remained readable by the importer. The backup's internal title retained all 120 characters. The Word download-event listener timed out; the actual file on disk and successful reimport supplied completion evidence instead.

Actual homepage file-chooser reimport:

- Backup: `0ba8f4f1-3afb-442f-a818-f2a3043d9834`, renamed `QA long title backup recovery 2026-10-07`. The full title and complete document JSON matched the export snapshot.
- Word: `fb8d4e40-a9f2-4603-8442-fc09f560e896`, renamed `QA long title Word recovery 2026-10-07`. Both multilingual paragraphs and first-paragraph bold formatting were present.
- Both recovery samples were moved into `QA · Local workspace` using the UI.

The same run found that a three-line Word download label overflowed its fixed 37px button at an 800px viewport. After allowing automatic height, the button was 76.5px high and its 54px text bounds fit. At 1280px, the 57px button contained the 34.5px text bounds. The temporary viewport override was reset. This verifies the browser layout and local downloads, not Safari native PDF output or operating-system IME behavior.
