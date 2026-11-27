# Plan - P3-3a：全局专业 Session 并发配额

## 目标

限制同时运行的非 Chief/non-investigator 专业 Session 数，超出时保持输入 queued，不提前 claim。

## 范围

- `Store.countProcessingSpecialists`：processing 且 role 非 chief/investigator，排除 pending interaction。
- `InputRunner` 在 claim 之前做非阻塞检查；返回 `throttled`。
- `KAIMING_MAX_CONCURRENT_SPECIALISTS` 默认 4；unit runner 未配置时不限制。
- 测试计数与完整套件。

## 验证档

`broad`：共享调度层。运行 store/runtime/step-wake 与全量单元套件。

## 验收

- 计数只含活跃专业输入；chief/investigator 不计；waiting_user 不计。
- 超限输入保持 queued；worker 不把它当 progress；释放后下一轮可 claim。
- 全量套件通过。
