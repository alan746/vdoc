// Browser file delivery (anchor download + object URL lifecycle).
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  let requested = false;
  try {
    anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
    document.body.appendChild(anchor); anchor.click(); requested = true;
  } finally {
    // A failed DOM operation must not leave a large document URL or anchor behind.
    // Successful clicks still need time for the browser to consume the download.
    try { anchor?.remove(); }
    finally {
      if (requested) setTimeout(() => URL.revokeObjectURL(url), 60_000);
      else URL.revokeObjectURL(url);
    }
  }
}
export function downloadFile(name: string, content: string, type: string) {
  downloadBlob(name, new Blob([content], { type }));
}
