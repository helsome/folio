import type { SameKeysAs } from '../keys.ts';
import type { connections as enConnections } from '../en-US/connections.ts';

/** Connections / providers surface — Simplified Chinese. Provider & model ids stay untranslated (§11). */
export const connections = {
  title: '连接',
  providerCount: '{{count}} 个提供方',
  notWired:
    '此版本尚未接入提供方连接——连接 IPC 上线后这里才会显示列表。',
  loading: '正在加载连接…',
  noneConfigured: '尚未配置提供方。',
  capabilityMatrix: '能力矩阵',
  noCoverage: '注册提供方后将显示覆盖数据。',
  provider: '提供方',
  kindFinancialData: '金融数据',
  kindBrokerAccount: '券商账户',
  waitingAuthorization: '等待授权…',
  openVerificationPage: '打开验证页面',
  authorizeHint: '在浏览器中授权后返回此处——本页会自动更新。',
  enterApiKey: '输入你的 API 密钥',
  apiKey: 'API 密钥',
  saving: '正在保存…',
  connect: '连接',
  connecting: '正在连接…',
  testConnection: '测试连接',
  testing: '正在测试…',
  disconnect: '断开',
  disconnecting: '正在断开…',
  reconnect: '重新连接',
  installSetup: '安装 / 设置',
  byokNote:
    '你自己的密钥决定使用情况。免费套餐可能返回当日结束后的数据（每分钟 5 次调用）并要求注明来源（“Powered by Polygon.io”）。',
  dismissError: '关闭错误',
  dismiss: '关闭',
  portfolioReady: '投资组合 ✓',
  connectionFailed: '连接失败。',
  enterApiKeyError: '请输入 API 密钥。',
  saveApiKeyFailed: '无法保存 API 密钥。',
  disconnectFailed: '断开失败。',
  testFailed: '测试失败。',
} satisfies SameKeysAs<typeof enConnections>;
