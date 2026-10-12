# Settlement Report · devagent-p7-model-config-20261010

```yaml
settlement:
  task: devagent-p7-model-config-20261010
  stable_facts:
    - "系统现在支持配置 provider（`config.save` kind=provider）：定义写入 `<dataDir>/models.json`（Pi 自己的形态，0600、临时文件 + rename 原子替换），库里只记 `credentialRef`；密钥不进数据库、不进任何响应体（响应只给 `credentialRef/revision/models` 与 `credentials:{mode:'reference',inResponse:false}`）"
    - "角色/项目两级模型覆盖可用：`model_overrides`(scope+scopeId, providerId, modelId) 按 revision CAS；解析优先级 role → project → server，由唯一实现 `resolveStoredConfig()`（`src/runtime/config.ts`）供 `config.get`/`config.test` 与 runner 认领路径共用"
    - "保存后无需重启即生效：`config.save` 写入 provider 后 await 同一 factory 的 `reload()`（main.ts 注入），下一次被认领的输入即用新配置"
    - "`config.test` 是真实试连：对可用选择发起一次真实一 token 调用（8s 上限），如实返回上游错误原文；不落盘、不建会话、不回显密钥；并复用 runner 的同一工厂，所以它说的状态就是运行会看到的状态"
    - "覆盖真的作用到运行：同一会话实跑对照——覆盖前 `effectiveConfig` = `deepseek-flash / source=server`；修复前认领仍 `server`（缺陷，见下）；修复后 `deepseek-chat / source=role`，且 Pi 原生历史该轮 `message.model = \"deepseek-chat\"`"
    - "活动输入不受设置变更影响（实跑取证）：运行停在 `question` 上时保存 provider（加入第二个模型）并把项目覆盖指到 `stub-2`，回答后该输入的第二轮模型请求仍走 `stub-1`；`session.input.get` 的 `effectiveConfig` 仍为 `stub-1 / source=server`"
    - "已执行输入的真实配置可查：每个认领记录 `effectiveConfig`（脱敏配置 + 请求/生效工具名），`session.input.get` 现在返回它；会话绑定另记 `configHash`，`session.recovery.inspect` 可读"
    - "模型文件工具够不到服务器私有存储：会话级 Pi 扩展 `src/runtime/tool-guard.ts` 在任何工具执行前拦截指向私有目录（数据目录 + 凭证目录，realpath 比较）的 read/edit/write/ls/find/grep，以及命令文本中出现该目录的 bash/powershell；写法归一化与 Pi **同序**（Unicode 空格 → 去一个 `@` → 展开 `~/` → `file://` 转路径 → 解析），未存在的路径经最深的已存在祖先解析（挡住经符号链接父目录的写入）"
    - "文档按事实改写：P-05 改为承诺“凭证不出现在产品自身的读取面 + 模型文件工具不得读私有存储”，并明示边界（命令与操作者同权限，刻意绕过仍可读本机文件；更强保证需另立沙箱需求）；README 记同一边界与 `config.*` 用法"
    - "证据边界：AC-27 只覆盖本轮可达范围（配置默认与角色/项目模型、试连、覆盖可辨认、正常读取无凭证）；AC-27 之外的产品验收场景本轮未执行"
  updated:
    - "devagent/src/store/store.ts：schema v8（`providers`、`model_overrides`）+ `migrateV7ToV8()`；provider/override 的 CAS 读写"
    - "devagent/src/runtime/provider-store.ts：私有凭证文件写入（0600、原子替换，只记引用）"
    - "devagent/src/runtime/config.ts：`resolveStoredConfig()` 唯一实现（role → project → server）"
    - "devagent/src/runtime/pi-runtime.ts：`reload()`；`probe()` 复用同一运行时"
    - "devagent/src/runtime/tool-guard.ts（新增）：私有路径守卫（含写法归一化与祖先解析）"
    - "devagent/src/runtime/runner.ts：认领时解析带 projectId；每个会话安装守卫；记录 `effectiveConfig`/`configHash`"
    - "devagent/src/server/methods.ts / main.ts：`config.save/get/test`、注入 reload 与 probe、入口解析相对 `AGENTDEV_DATA_DIR`、`privateDirs`"
    - "devagent/src/server/read-methods.ts：`session.input.get` 返回记录中的脱敏生效配置"
    - "docs/productnew/modules/project-workspace.md（P-05 按事实改写）、devagent/README.md（边界 + config.* 用法）"
    - "devagent/test/：provider-config.test.ts、tool-guard.test.ts（9 项）、workbench-entry.test.ts（3 项）"
    - ".agentdev/work/devagent-p7-model-config-20261010/：plan/implementation/test/review/settlement"
  verification:
    - "tsc 0；npm test 228/228（22 文件）；playwright 8 passed；check:prompts 15/15；verify-selectors 485/485（extra 0）"
    - "独立复核三轮：Round 1 failed（2 阻断：B2 保存后运行时未重载、B1 凭证被内建 read 读入对话）→ 处置并修复；Round 2 failed（2 新阻断：守卫可被 `@`/`file://`/`~/` 写法绕过、未存在路径经符号链接写入被放行；2 项非阻断）→ 修复；Round 3 failed（1 新阻断：归一化次序与 Pi 相反导致 `@file://…` 漏过）→ 修复；Round 4 增量复核见 review.md 末节"
  checklist_result: "计划内的存储、配置服务、认领解析、复核修复四个切片全部完成；三轮独立复核发现的问题全部修复；未取证项逐条登记"
  not_covered:
    - "**不是沙箱**：`bash` 用变量/`cd` 等写法仍可能读到私有目录；这是 P-05 改写后明示的不承诺项，要真保证需另立操作系统级沙箱需求"
    - "无前端配置入口（本轮用户明确要求界面不需要编辑入口）；无 `config.delete`（未新增契约外的删除语义，撤销覆盖=改回服务器默认值）；密钥为明文 0600（与既有 auth.json/models.json 一致），无加密/轮换"
    - "R5“恢复已执行输入按原配置、不可用则等明确变更”的比较与拒绝逻辑：本实现不重放旧输入（S7 要求先核实关闭、后续工作由新输入接续），故无落点；`effectiveConfig` 已可读，届时必须据此拒绝而不是换模型"
    - "AC-27 以外的验收场景未执行；本包未做真实模型的端到端回归（只做了 stub 实跑与一次真实 provider 试连）"
  indexes_updated:
    - "docs/technicalnew/validation.md（P7 实施证据与未覆盖项）"
  archived:
    - .agentdev/work/devagent-p7-model-config-20261010/
  no_change:
    - "oldcode/、docs/old/、docs/architecturenew/、webui/"
  completion_gate: pending_round4
```
