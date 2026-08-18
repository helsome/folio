// V7 — LangSmith Pi extension entry (dev).
//
// Loads the official @langchain/langsmith-pi-extension (MIT) through Pi's
// explicit `--extension` mechanism. This wrapper exists so the repo's spawn
// config can point at a stable in-repo path; the packaged app ships the
// esbuild bundle of the same factory at `extensions/langsmith/index.js`.
import langsmithExtension from '@langchain/langsmith-pi-extension';

export default langsmithExtension;