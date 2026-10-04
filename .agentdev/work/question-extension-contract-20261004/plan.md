# question 扩展与 WAL 消息契约

类型：已确认技术设计修改，业务代码不在本次范围。

目标：以 Pi v1.0.0 官方 question 扩展为模型提问入口，接入既有原生交互、WAL 与主管通道；扩展与前端界面分离。

已确认决定：复用 Pi 原生协议；采用官方扩展注册方式；模型自行选择通用交互类型并解释业务答复，宿主仅保存并核对请求事实，不增加业务确认类型或模型管理的交互生命周期。

范围：G2 扩展参数/装配、M5 请求响应/执行顺序、R4 接入、S2/S6 事实校验边界、接入检查、必要提示词说明与当前验证记录。其余全面审查发现不在本次修复范围。

实现依据：官方 examples/extensions/question.ts、SDK 的 resourceLoader/extensionFactories、ExtensionUIContext 的 select/confirm/input。官方示例的自定义 TUI 不适用于本产品浏览器，移植工具注册方式，参数对应通用 confirm/select/input，通过宿主 UIAdapter 接入现有 WAL。

验证：独立上下文 Review；当前文档链接、Mermaid、JSON、TypeScript 与差异检查。SDK/模型/浏览器运行场景继续 NOT_RUN。

结算：保存本次审阅和静态证据，更新全面审查中 DA-03 的处置与当前验证入口，只提交本次文档和工作记录，保护其他工作区改动。
