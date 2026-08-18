import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFinagentClient, type AboutInfo } from '../../client';

// Dev fallbacks mirror apps/electron/package.json. They render until the
// `app:about` IPC is wired through the preload/client (Lead integration), at
// which point `client.about.get()` supplies the authoritative values —
// including the real build SHA via FINAGENT_BUILD_SHA.
const FALLBACK_INFO: AboutInfo = {
  version: '0.4.0-beta.1',
  channel: 'beta',
  build: 'dev',
};

/** About/version panel: version, channel, and build (git SHA) for this install. */
export const AboutView: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [info, setInfo] = useState<AboutInfo>(FALLBACK_INFO);

  useEffect(() => {
    let mounted = true;
    const about = client.about;
    if (!about) return;
    about.get().then((result) => {
      if (mounted && result.ok) {
        setInfo(result.data);
      }
    });
    return () => {
      mounted = false;
    };
  }, [client]);

  const rows: Array<{ label: string; value: string }> = [
    { label: t('settings.about.version'), value: info.version },
    { label: t('settings.about.channel'), value: info.channel },
    { label: t('settings.about.build'), value: info.build },
  ];

  return (
    <dl className="space-y-3" data-testid="about-view">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4">
          <dt className="text-[13px] text-foreground/54">{row.label}</dt>
          <dd className="text-right text-[13px] font-medium tabular-nums text-foreground">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
};
