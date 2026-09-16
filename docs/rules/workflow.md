# 工作路由与分级交付规则

## 1. 请求评估

每条用户请求由Chief生成Assessment：intent、goal、scope、authorization_ref、semantic_impact、risk_flags、uncertainties、level、reason。intent取assist、artifact、document、delivery、operation。问答/解释为assist；独立说明为artifact；正式知识保存为document；项目代码/配置变更为delivery；部署、服务和数据操作为operation。

Core检查角色、字段、授权、权限和版本；语义分类由Chief负责，有事实冲突时先调查，仍需用户选择则创建Decision。AI识别可改善之处只形成建议。执行消息可直接授权明确目标；混合消息拆多个Work分别绑定相同来源和各自范围。默认在宿主执行；已批准范围内的操作直接执行、不再逐次询问，只有不可逆操作（把交付分支推送到远端、部署/发布、删除数据）需要用户明确批准。

## 2. 等级判断顺序

1. assist/artifact为level=none，直接调用工具或Chief分派独立分析/制作Agent，完成后交付。
2. operation涉及运行环境、网络写入或数据操作，使用L3与明确操作授权。
3. delivery/document命中L3风险：身份认证、权限判断、Secret、安全边界、数据删除/迁移、支付金额/状态、公开协议不兼容、部署/发布、项目门禁规则变化。
4. L1需全部成立：目标替换明确；只涉及样式/文案/注释/普通说明；无行为、公开接口、数据结构、依赖/锁文件、可执行配置或测试断言改变；≤3文件且非生成Diff新增+删除≤20行；关联未知已排除。
5. 其余为L2。用户改变产品语义仍先保存决定，即使规模很小。

文件数/行数为保守准入条件，非安全证明。实现Diff超过条件或发现风险自动升级并补齐新增Gate。升级保持同Work和已有证据；独立L1升级L2/L3时创建关联Requirement并以原执行授权激活原范围，新增范围另行确认。自动降级不支持；用户批准变更策略后新Work可采用新等级。

## 3. 各路线

| 路线 | 必需阶段 | 实际执行角色 |
|---|---|---|
| assist/artifact | 理解→读取/分析/制作→交付 | Chief，可分派任意适用只读/产物角色 |
| L1代码/文案修改 | CompactPlan→Develop→ReviewCheck→Settle→Done | Chief写一句话计划；Frontend/Backend；独立Review；Settlement |
| L2/L3代码 | Product（若已有效可复用）→Plan→Develop→Review→Test→Accept→Settle | Product、Planning、Frontend/Backend、Review、Test、Settlement，均由Chief独立触发 |
| 正式文档 | Product或Planning准备授权文档Diff→ReviewCheck→Settle | Product负责行为文档、Planning负责技术文档；独立Review；Settlement |
| L3运行操作 | Plan→Execute→Review→Verify→Settle | Planning、Backend/Frontend执行、Review、Test验证、Settlement |

正式文档路线按风险分级，L2/L3要求版本化Plan和逐项语义验收；L1使用CompactPlan。文档内容包含可执行配置、脚本或改变软件行为时采用代码路线。ReviewCheck执行目标替换、Diff范围、文档/链接或必要构建检查；无单独Test Run，但记录实际检查结果。

每个实际专业职责均在独立Agent运行；共享记录格式不合并Developer和Reviewer的上下文。主管只负责调度和自己的问答/产物工作。专业Agent只能请求主管调度其他角色。

## 4. Product/Plan Gate

ProductDefinition必需goal、scope、observable_behaviors、acceptance_ids、constraints、decision_refs。Plan必需版本、任务DAG、角色、写入范围、接口/数据影响、验收映射、验证策略、风险与回退（L3）。

范围内明确化可AutoAccepted/AutoApproved：授权引用有效，未新增语义选择/权限/风险，所有验收映射完整，预算有效。其余DecisionRequired。L1 CompactPlan只有goal、paths、expected_change、check、authorization_ref，由用户明确请求和项目L1策略共同授权。

## 5. 状态机

### 5.1 Work和Requirement

Work.status：queued→running→completed；running可进入blocked、paused、cancelling；blocked/paused通过恢复返回running；cancelling→cancelled或blocked(recovery)。执行不可恢复错误为failed；failed只能启动同Work的新Run尝试，保留原失败证据。完成后追问创建关联新Work。

Requirement.lifecycle：queued→active→completed→archived；queued可archived或cancelled，active可cancelled（安全处置后）。取消处理中仍active。Archived保存previous_lifecycle，仅queued/completed可恢复原状态。Requirement.phase：product、plan、execute、accept、settle；只在active使用。本机执行控制从所属Work派生；Git导入active且无Work时executionAvailability=needs_replan，phase为空、显示待继续。用户继续后建立新Work并重新规划，导入不启动运行。

Work.blocker：decision、permission、budget、dependency、provider、test_environment、recovery。一个Work可有多个阻断记录；所有适用阻断关闭才恢复，恢复不表示跳过Gate。

### 5.2 Task

Task.stage：ready、develop、review、test、done。L1和文档路线review通过进入done；L2/L3代码review通过进入test。阻断状态派生自Work/Run。Review或Test失败返回develop；修复后重新独立Review。done依赖的产品/Plan/代码失效时重开ready并撤销引用的有效性。

### 5.3 Run/Attempt

Run.status：queued、starting、running、waiting_permission、waiting_children、paused、interrupted、recovery_required、completed、failed、cancelled、timed_out、contract_violation。completed/failed/cancelled/timed_out/contract_violation终态；后续工作创建新Run。interrupted可检查后创建新Attempt；不确定副作用为recovery_required，只有RecoveryDecision关闭后创建新Attempt。

Attempt.status：starting、running、stopped、completed、failed、lost；离开running的Attempt不可重写其证据。暂停关闭当前Attempt，恢复用Checkpoint创建新Attempt。Run可跨Attempt延续。

## 6. 发现与返工

Discovery：defect、technical_correction、product_change、followup、blocking_risk。保存证据、影响、建议、实际路由、关联Finding/Decision。缺陷和范围内技术修正自动返工；产品变化给出本次处理/以后处理/不采纳。

本次：保存Decision→更新需求工作版本的ProductDefinition/验收→新Plan→失效受影响任务/报告→继续。以后：新Queued Requirement，当前验收保持。不采纳：保留原因，仍须符合当前验收。优化建议不自动建单。

Finding严重性：P0数据/安全或关键不可用，P1错误行为/需求缺失，P2局部质量/维护问题，P3建议。P0/P1阻断；P2/P3由Review说明是否影响验收，影响验收则阻断。审核target为task/integration/document；taskId仅task目标必填。integration/document问题由Chief分派相应修复任务或文档修改Run，最终新目标再次独立Review。状态open→addressed→verified或accepted_risk；只有独立Review能verified，产品/剩余风险接受由用户决定并记录，风险接受不自动修改验收。

Test结果passed/failed/not_covered/blocked；failed自动返工，blocked保持等待；not_covered关联明确验收ID，用户明确风险处置且未违反不可覆盖的权限/Gate规则才可放行。报告不能以“应该通过”代替执行。

## 7. 完成、暂停、取消

所有Done Task形成候选集成，按route验证：L1及纯文档使用ReviewCheck与适用检查；L2/L3代码使用独立Review和Test，并按关联Requirement执行整体验收。单Task且候选树/语义依据一致可复用相应路线的有效证据，Core记录复用Manifest。多Task组合按同一路线验证；L1超出等级边界先升级，不因为集成操作本身强制新增Test阶段。只有存在requirementId时更新Requirement状态。

暂停停止新准入，在安全点关闭Attempt并保留Checkpoint。取消传播子Run；60秒内尝试终止执行进程，未能确定副作用则进入recovery_required。安全取消后Work/Requirement为cancelled，保留候选成果，正式交付分支保持取消前已提交结果。

Settlement核对实际Diff、功能、代码/测试入口、规则、失效知识、证据。代码树未改变且仅技术事实/索引更新，执行文档检查后结算；产品语义/规则或代码改变返回对应Gate。最终完成清单绑定验证代码树、最终文档Revision和证据Hash。失败停在settle可恢复。

## 8. 需求持久化门禁

需求创建及状态变更按[需求池规则](../product/requirements.md)立即保存Git，元数据提交由Core执行。start在active记录提交后才允许创建执行Run；completed记录与最终知识一起提交且适用Gate已通过。归档/取消保留文件作为历史记录。
