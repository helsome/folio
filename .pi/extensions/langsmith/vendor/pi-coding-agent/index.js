// V7 — build-time shim for the LangSmith Pi extension.
//
// The extension's dist imports `{ VERSION }` from `@earendil-works/pi-coding-agent`
// to stamp the Pi runtime version onto trace metadata. Bundling the real package
// drags in the entire Pi runtime (including undici, which the current bundler
// cannot bundle into a working node-target module), so the packaged bundle
// resolves this tiny shim instead: VERSION is inlined at build time and the
// bundle stays self-contained. Dev-mode imports resolve to the same shim via
// the root devDependency, so dev and packaged metadata agree.
export const VERSION = '0.82.1';