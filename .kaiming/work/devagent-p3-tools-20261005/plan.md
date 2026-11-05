# Plan · devagent-p3-tools-20261005

状态：Draft（用户指令「继续 P3」；本计划先落文字，实施按切片推进）
依据：角色与工具契约（G1～G5）、消息与协作（M1～M3）、存储（S2/S3/S6）、产品（D/R/K）、实现检查 I2 的 P3。

```yaml
plan:
  task: devagent-p3-tools-20261005
  goal: >
    让运行时具备"主管组织专业工作"的能力：按角色装配提示词与上下文、按角色裁剪工具集、
    提供四个主管核心工具与辅助工具、按当前步骤委派专业会话并聚合等待，全部字段与语义照 G2/M1/M2。
  slices:
    - id: P3-a 上下文装配
      change: 按 G4 装配注入正文（base/specialists/角色正文，英文）+ 项目入口 + 当前 Task/Plan/授权/输入与依据路径
      verify: [装配结果包含全部必需正文与入口；英文检查通过；不注入其它角色正文]
    - id: P3-b 角色与工具集
      change: 角色注册表 + 按 G1 裁剪工具（chief 与专业、read/write Task 差异、Reviewer 只读）
      verify: [每个角色的可见工具集与 G1 一致；read Task 不给写工具]
    - id: P3-c Task 核心工具
      change: createTask/updateTask/endTask/task(get) 的字段、阶段枚举、CAS、计划落盘（.dev/work 或 Server work）
      verify: [创建/更新/结束的真实落盘与版本冲突；read/write 完成条件差异]
    - id: P3-d 委派与等待
      change: createTaskSessions（create/wait/continue）+ 当前步骤聚合 + 超时返回快照 + 与 Dispatcher 的配合
      verify: [多成员聚合、一份报告不提前返回、超时只快照、continue 只对已停稳成员]
    - id: P3-e 报告与需求工具
      change: agent_report（body/reportRef、checks、verdict、supersede）、requirement(list/get/save 含 CAS 与双类型格式)、project.initialize（差异确认）
      verify: [报告落盘与替换关系；需求保存校验与冲突；初始化差异需真实决定]
  out_of_scope:
    - HTTP/SSE 与浏览器 UI（P4）；结算跨存储顺序的完整实现（P5）
  constraints:
    - 注入模型的系统级文本一律英文；模型回复跟随用户语言（已由 checks/prompt-language.ts 守护）
    - 程序只核对身份/状态/版本/保存事实，不解析自然语言意图；不新增业务确认类型
    - 工具按工具级 executionMode=sequential 注册；不按 op 动态切换
  risks:
    - 工具体量较大，切片之间共享 Task 存储字段；每切片单独审阅，避免一次性大改
  approval: approved-by-user-instruction
```