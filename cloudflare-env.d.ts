declare namespace Cloudflare {
  interface Env {
    DATABASE_URL?: string;
    AUTH_BASE_URL?: string;
    BETTER_AUTH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    VDOC_SERVER_URL?: string;
    VDOC_SERVER_CLIENT_KEY?: string;
    VDOC_VOICE_DOCUMENT_ACCESS?: string;
  }
}
