import { unwrapIpcResult } from '../client/unwrap';

/**
 * Export & share loaders (spec §54–55).
 *
 * The main process renders stored reports using packages/shared/src/export
 * and answers over the export IPC channels with the usual
 * `{ ok, data | error }` envelope. JSON failures reject so ExportMenu can
 * display the existing error state.
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
    json?: (input: { reportId: string }) => Promise<unknown>;
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

/** Load the persisted report's JSON archive; reject unavailable or failed exports. */
export async function loadExportJson(reportId: string): Promise<string> {
  const channel = api();
  if (!channel?.json) throw new Error('JSON export channel is unavailable');
  const value = unwrapIpcResult<string>(await channel.json({ reportId }));
  if (typeof value !== 'string') throw new Error('JSON export failed');
  return value;
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
