import type { SameKeysAs } from '../keys.ts';
import type { profile as enProfile } from '../en-US/profile.ts';

export const profile = {
  eyebrow: '工作区身份',
  title: '个人与安全',
  subtitle: '查看本地 Folio 工作区、已连接的提供商和运行时健康状态。',
  localWorkspace: '本地 Folio 工作区',
  localWorkspaceDescription: '研究数据和凭据由当前桌面安装管理。',
  application: '应用',
  channel: '渠道',
  version: '版本',
  build: '构建',
  connectionsEyebrow: '提供商访问',
  connectionsTitle: '已连接服务',
  manage: '管理',
  noConnections: '当前版本没有可用的连接条目。',
  securityEyebrow: '运行时安全',
  securityTitle: '健康检查',
  healthAi: 'AI 提供商',
  healthMarketData: '行情数据',
  healthSkills: '技能',
  healthRuntime: 'Agent 运行时',
  ready: '正常',
  needsAttention: '需要关注',
  securityHint: '凭据不会在此处显示。请前往“连接”配置或移除提供商。',
  openConnections: '打开连接设置',
} satisfies SameKeysAs<typeof enProfile>;
