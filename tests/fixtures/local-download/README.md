# Real browser downloads

These immutable fixtures were downloaded through VDoc's File menu / Export button
in the Codex in-app browser on 2026-10-03 (acceptance round 49). They contain only
the agent-created `QA rich image round 43` sample, document ID
`6ff95dff-dbfd-4828-abc1-40a3a0bc01c2`: English, Chinese, Japanese and Arabic text,
a two-row merged table, one RTL paragraph and a 300×150 embedded image.

The files were first saved by the browser under `~/Downloads/QA rich image round 43.*`,
then copied byte-for-byte here. They are not regenerated from the current exporter
during tests. A second HTML download after the round-49 changes matched byte-for-byte.

`downloaded-files.test.ts` reads these bytes using the production importer for
JSON, DOCX and TXT, and checks the HTML with DOMParser. This is **not** proof of
reimport through the native file picker or visual fidelity in desktop Word.

SHA-256:

| File | Digest |
|---|---|
| mixed.docx | d9c9f11e87605a5534203f3b937b7cf5c93067da882cdd3b15cf5b7b8786f6ba |
| mixed.html | f1343e23baef23d167684db19fd8e59b992a97548594cac3d55e042bce5f24ba |
| mixed.txt | b2e4968c9ef7cdeac32d414d40f8b98698e34c5f0e1eabd4bd9d2d27d056536a |
| mixed.vdoc.json | 0d72394d437f77cee2b72651ae9f01117bd6f869e9c58a944b43dfa92d09f7f3 |
| mixed.readable.txt | 601b7d0a583b8f1c686403384b430520f9b651ada77e8bf2284c80cea4ff68c9 |

`mixed.readable.txt` was downloaded in round 50 from the same unchanged QA
document after the dedicated text serializer was added, as
`~/Downloads/QA rich image round 43 (1).txt` (134 bytes). It retains table columns,
empty merged slots and image alt text. `mixed.txt` remains the original round-49
download to cover reading older exports. Neither fixture is a format-preserving backup.
