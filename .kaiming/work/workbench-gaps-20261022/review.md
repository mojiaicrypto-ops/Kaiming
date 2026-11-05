# Review · workbench-gaps-20261022

独立审阅：新上下文、只读、不读开发聊天；依据 `plan.md`、`gap-register.md` 与实际代码。

## 第一轮

```yaml
review:
  round: 1
  reviewer_session: GapCloseReview
  result: passed
  blocking: []
  non_blocking:
    - state/useWorkspace.ts: 服务端 lastActivityAt 未映射到客户端 updatedAt，会话列时间恒为空
    - gap-register U10 声称"保持滚动位置"，代码无补偿；触发方式实为按钮
    - gap-register U7 声称四个入口，界面只有三个文件入口
    - requirements: 任务段无分页（limit 50，无"更多"）
    - server/read-methods.ts: parseRecordedConfig 无调用
    - useSession.ts: 推送后 1 秒内的兜底 tick 未跳过（计划 §6 的缓解未实现）
    - chat/TaskDrawer.tsx: 切换结果时旧正文短暂残留
    - files/FileDrawer.tsx: 目录符号链接点击返回 NOT_FOUND
    - chat/Composer.tsx: 相同交接文本二次提交被静默忽略
    - 计划/B: 项目菜单未用"拦截计数"验证
    - 计划/C: dispatch 推送只有间接覆盖
    - 计划/E: 无 101 条以上的前插与视口不跳用例
  notes: 归属校验、路径包含、cursor 校验、CAS、配置白名单、成员/主管区分均被确认无问题
```

## 第二轮（核对修复）

```yaml
review:
  round: 2
  reviewer_session: GapCloseReview
  result: passed
  blocking: []
  still_open:
    - gap-register U10 的处置文本未同步（代码已是按钮 + 锚定）
  verified:
    - 会话列字段映射（useWorkspace.ts:96-118）
    - 前插后 scrollTop 补偿（ChatPage.tsx:258-273）
    - 任务段分页（requirement-model.ts:103-145、RequirementsPage.tsx:150-152）
    - 推送去重（useSession.ts:139,312-315）
    - TaskDrawer 清空、符号链接禁用、交接重试（各自位置）
    - 新用例：项目菜单来自服务端、dispatch 后成员数立即出现（acceptance.spec.ts:722-747、504）
    - 死代码已删除
```

处置：U10 文本已按代码改写并复读确认。

## 结果

```yaml
result: passed
basis:
  - 两轮结论均为 passed，无阻断项；第一轮 9 项非阻断已全部修复，第二轮仅剩 1 项文档措辞，已改
  - tsc（服务端/外壳）无输出；npm test 299；npm --prefix webapp test 25；npm run test:browser 27
```

未由独立审阅判定的部分：真实模型下的完整 J-01～J-10；U4/U5 的交互形态（未实现，见 `questions.md`）。
