declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    VDOC_SERVER_URL?: string;
    VDOC_SERVER_CLIENT_KEY?: string;
    VDOC_VOICE_DOCUMENT_ACCESS?: string;
  }
}
