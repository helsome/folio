import { unwrapIpcResult } from '../client/unwrap';

/**
 * Export & share loaders (spec §54–55).
 *
 * The main process renders Markdown / the share card from a stored report
 * with the pure functions in packages/shared/src/export and answers over the
 * `export:markdown` / `export:shareCard` channels with the usual
 * `{ ok, data | error }` envelope. Every loader degrades to `null` when the
 * channel is not wired yet, so the ExportMenu never crashes pre-integration.
 */

/** Renderer-facing mirror of the shared ShareCard payload. */
export interface ShareCardPayload {
  svg: string;
  text: string;
}

/** Minimal shape of the electron API surface we consume. */
interface ExportElectronApi {
  export?: {
    markdown?: (input: { reportId: string }) => Promise<unknown>;
    shareCard?: (input: { reportId: string }) => Promise<unknown>;
  };
}

function api(): ExportElectronApi['export'] {
  const electronApi = (window as { electronAPI?: ExportElectronApi }).electronAPI;
  return electronApi?.export;
}

/** Render the report as Markdown; null when unwired or failing. */
export async function loadExportMarkdown(reportId: string): Promise<string | null> {
  try {
    const channel = api();
    if (!channel?.markdown) return null;
    return unwrapIpcResult<string>(await channel.markdown({ reportId })) ?? null;
  } catch {
    return null;
  }
}

/** Render the share card (SVG + text); null when unwired or failing. */
export async function loadShareCard(reportId: string): Promise<ShareCardPayload | null> {
  try {
    const channel = api();
    if (!channel?.shareCard) return null;
    return unwrapIpcResult<ShareCardPayload>(await channel.shareCard({ reportId })) ?? null;
  } catch {
    return null;
  }
}
