/**
 * Namespace resource typings.
 *
 * Namespaces may hold flat keys (`save: 'Save'`) or nested groups at any
 * depth (`sections: { stance: { bullish: '…' } }`) — i18next resolves both as
 * `settings.sections.stance.bullish`. `SameKeysAs<T>` enforces at compile time
 * that a Chinese namespace defines at least every top-level key its English
 * twin defines (missing translations fail the build); exact parity including
 * extras is enforced by `i18n:check` at CI.
 */

export type NsValue = string | Record<string, string | Record<string, string>>;

export type NamespaceResource = Record<string, NsValue>;

export type SameKeysAs<T> = Record<keyof T, unknown>;
