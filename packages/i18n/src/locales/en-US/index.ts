import { common } from './common.ts';
import { navigation } from './navigation.ts';
import { settings } from './settings.ts';
import { errors } from './errors.ts';
import { evaluation } from './evaluation.ts';
import { performance } from './performance.ts';
import { security } from './security.ts';
import { research } from './research.ts';
import { thesis } from './thesis.ts';
import { portfolio } from './portfolio.ts';
import { compare } from './compare.ts';
import { alerts } from './alerts.ts';
import { automation } from './automation.ts';
import { connections } from './connections.ts';
import { onboarding } from './onboarding.ts';
import { diagnostics } from './diagnostics.ts';
import { today } from './today.ts';
import { discover } from './discover.ts';
import { agent } from './agent.ts';

/**
 * en-US resource bundle. Feature slices add their own namespace here (today,
 * discover, research, …) alongside the matching zh-CN entry.
 */
export const enUsResources = {
  common,
  navigation,
  settings,
  errors,
  evaluation,
  performance,
  security,
  research,
  thesis,
  portfolio,
  compare,
  alerts,
  automation,
  connections,
  onboarding,
  diagnostics,
  today,
  discover,
  agent,
};
