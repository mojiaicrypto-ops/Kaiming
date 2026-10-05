# Plan · devagent-p1-store-dispatcher-20261005

状态：Draft（待用户确认或按既有授权执行；P0 与其后续小包已结算后启动）
依据：存储与恢复契约（S1～S3）、运行契约（R2/R3）、架构（A3/A4）、实现检查（I2 的 P1）。

```yaml
plan:
  task: devagent-p1-store-dispatcher-20261005
  goal: >
    做出一层可独立验证的存储与调度内核：输入可靠接纳与去重、事务认领、同一会话串行、
    扫描兜底、版本冲突（CAS）保护，以及重启后对旧「处理中」记录的核实分类。
    本包不调用任何模型，可先用存储夹具独立验证。
  in_scope:
    - SQLite 表结构与启动期 PRAGMA 校验（WAL、synchronous=FULL、foreign_keys=ON）
    - 接纳：请求回执去重（同 key 同参数复用；同 key 不同参数冲突）、队列序号、状态 queued
    - 认领：事务 CAS queued→processing + 执行代次；同一会话同时只允许一项处理中
    - 控制意图：输入级停止意图、Task 级暂停/取消意图的持久化（不实现 Pi 侧停止）
    - 扫描兜底：提交后唤醒 + 周期扫描；不直接消费 WAL 文件
    - 重启分类：旧 processing 行按事实归入 interrupted，禁止自动重投
    - 记录：projects/sessions/session_bindings/tasks/task_sessions/results/session_inputs/
      interactions/file_saves/request_receipts 的最小字段（先建真实用到的列，避免空表堆砌）
  out_of_scope:
    - Pi 运行时接入、工具注册、上下文装配（P2/P3）
    - HTTP/SSE 公开接口与浏览器界面（P4）
    - 业务语义判断（谁算完成、授权含义）——程序只核对身份/状态/版本/保存事实
    - 真正执行模型或工具；本包不做任何模型调用
  decisions:
    - 数据库驱动用 Node 内置 node:sqlite（Node 24.8 实测：文件库可设 WAL、synchronous=FULL、
      foreign_keys=ON，条件 UPDATE 返回 changes 可用于 CAS），不引入原生依赖
    - 运行时会打印 SQLite 实验特性警告；处理方式（屏蔽或记录）在实施时明确写出，不静默吞掉
    - 数据库文件路径由调用方给定（测试用临时目录），不写死全局路径
  steps:
    - id: P1-a
      change: schema 与 PRAGMA 校验 + 打开/关闭/迁移骨架
      verify: [对临时库执行初始化，断言 PRAGMA 实际值]
    - id: P1-b
      change: 接纳与回执（去重、冲突、序号、queued）
      verify: [同 key 重试、同 key 改参数、并发接纳 三种情形]
    - id: P1-c
      change: 认领与串行（CAS + 代次；同会话唯一 processing）
      verify: [两个并发认领只有一个成功；同会话第二项保持 queued]
    - id: P1-d
      change: 扫描兜底与控制意图持久化
      verify: [提交后未唤醒仍可被扫描消费；暂停/取消意图不被扫描自动解除]
    - id: P1-e
      change: 重启分类（旧 processing → interrupted，保留事实）
      verify: [关闭并重开数据库后断言分类与不可自动重投]
  review_focus:
    - 是否引入第二套重试/重放引擎（禁止）
    - 是否让调度层解释业务自然语言（禁止；只做状态与版本）
    - 同会话串行与代次失效是否真的能被并发测试反驳
    - 是否有静默吞错（保存失败不得返回成功）
  test_plan:
    - cd devagent && npx tsc --noEmit
    - 新增可执行检查（存储夹具），覆盖上述 verify 项；真实运行并记录退出码与关键输出
  document_impact:
    - 新增实现说明与测试记录；契约不需要改动（若发现字段不足，先记录再上报）
  risks:
    - node:sqlite 为实验特性：若关键行为与文档不符，按失败试验记录并评估 better-sqlite3
  rollback: 删除本包新增模块与表结构文件；不影响 P0 试验
  approval: pending-user-confirmation
```