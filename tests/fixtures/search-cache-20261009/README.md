# 长文档查找缓存与实际页面验收

2026-10-09，内置浏览器localhost:5173，独立2500段多语言样本。

- `source.vdoc.json` SHA-256：`2aea01723269671ce574afa277db9e9fb3ebf8f7b65db7566166df34663ba45e`。
- 标题：`QA search cache 2026-10-09`。
- 导入ID：`08fb41cd-9ccf-4ca0-a70d-c938b886dbe2`。
- 最终位置：QA · Local workspace（85项），内容还原为导入后基线。

实际页面File库Import后记录read_document完整JSON，2500块。Edit → Find and replace查找`SEARCH_CACHE_END`，末段当前高亮top443.78、bottom461.78，查找栏bottom200、viewport720；目标进入可见区。

查找NFC形式`café`，命中源文件NFD形式`café`共2500处。替换为`已替换 👩‍💻`后2500块均含新文字，无旧匹配；页面一次Undo完整JSON精确等于原基线，Redo精确等于替换后快照，再Undo回基线。关闭查找、单独确认Saved locally、返回首页，再新页面加载同一ID，新session且完整JSON仍精确一致。最后移动到QA目录。

局部计算基准：tests/search-performance.test.ts中2500段、12次局部编辑，每次测一次查找。优化前中位20.15ms/最大25.42ms，缓存后中位0.53ms/最大0.99ms；后续专项中位0.49ms。只测本机jsdom中findMatches计算，不能外推整个界面帧率、冷启动、其他设备或Safari。

5项新增测试覆盖长文档替换撤销、查询选项变化、合并表格块移动后的当前坐标、等长编辑及撤销重做、跨文字格式的组合字符与换行隔离。相关4文件55项、全套132文件1804项（70.33秒）、类型检查及随后生产构建通过。日志/tmp/vdoc-search-cache-{before,after,targeted,full,types,build}.log。

原七项实机签收仍未关闭；本轮为内置浏览器与自动化证据，不替代Safari查找/打印或系统输入法。
