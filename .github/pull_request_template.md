## 改动说明

<!-- 简要说明改了什么、为什么改 -->

## 关联 Issue

<!-- 例如：Closes #123 / Related to #123 -->

## 测试报告（正式审核前必填）

<!--
仅写“已测试”“unit tests cover ...”“本地通过”不算测试报告。
请填写真实执行结果；没有测试报告的 PR 不会被批准。
-->

### 环境

- Bun：
- OS：

### 实际执行命令与结果

```text
# 示例
bun test packages/shared/src/foo.test.ts
→ 12 passed / 0 failed

bun run typecheck
→ core/shared/ui/electron 全部 exit 0
```

### 已知失败 / Baseline（如有）

<!--
如果有失败，请说明：
1. 失败项；
2. 是否可在当前 main / origin/main 复现；
3. 为什么与本 PR 无关。
-->

- [ ] 已提供实际测试命令与 pass/fail 结果
- [ ] 已说明测试环境
- [ ] 如果存在已知 baseline / 环境失败，已提供 main 对照或说明
- [ ] 核心改动已有对应 focused test / smoke / integration 验证

## UI 截图（仅可见 UI 变化时必填）

<!--
只有用户可见的 UI 样式、布局、组件外观、文案呈现或可见状态发生变化时，才要求截图。
修改已有可见界面：优先贴 Before / After。
新增可见 UI：至少贴 After。

如果只是交互逻辑、安全校验、数据绑定、状态机、事件处理、IPC、缓存、持久化、UI 单测或内部重构，且视觉结果不变，请勾选“无可见 UI 变化”，不需要截图。
-->

- [ ] 本 PR 无可见 UI 变化（无需截图）
- [ ] 本 PR 有可见 UI 变化，已提供修改后的 UI 截图
- [ ] 已提供 Before / After 对比截图（适用时）

### Before（适用时）

<!-- 有可见 UI 变化时拖入截图 -->

### After（适用时）

<!-- 有可见 UI 变化时拖入截图 -->

## Scope / 后续

<!-- 如果只是完成大 Issue 的一个子能力，说明本 PR 边界和未完成项 -->
