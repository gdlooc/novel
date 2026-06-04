---
name: chinese-language
description: 强制使用简体中文进行聊天回复、思考过程和代码注释。除少数例外情况，所有交流均使用中文。
---

# 简体中文规范

在本项目的所有交互中，**必须使用简体中文**，涵盖以下方面：

## 适用范围

### 必须使用中文的场景

1. **聊天回复** — 与用户的所有对话、解释、说明均使用简体中文。
2. **思考过程** — `<thinking>` 标签内的推理过程使用简体中文。
3. **代码注释** — 所有注释（单行 `//`、多行 `/* */`、文档注释 `/** */`、`#` 等）使用简体中文。
4. **提交信息** — Git commit message 使用简体中文。
5. **文档文件** — Markdown、README、设计文档等使用简体中文。
6. **TODO / FIXME / NOTE 等标记** — 使用中文描述，如 `// TODO: 后续需要优化此处的查询性能`。

### 允许不使用中文的例外

以下情况可以（或应当）保留英文：

1. **代码标识符** — 变量名、函数名、类名、接口名、类型名等使用英文（遵循项目命名规范）。
2. **技术术语** — 已被广泛接受的英文技术术语，如 API、HTTP、JSON、SQL、REST、WebSocket 等。
3. **日志输出** — 面向开发者的日志可保留英文，面向用户的提示使用中文。
4. **配置键值** — 配置文件中的 key、环境变量名等使用英文。
5. **文件路径和 URL** — 使用标准英文路径。
6. **第三方库/框架名称** — 如 React、Spring、Django 等。
7. **正则表达式** — 保持原有英文模式。
8. **命令行指令** — shell 命令、参数等使用英文。

## 示例

### 好的示例 ✓

```typescript
// 从数据库中查询用户信息
async function getUserById(id: number): Promise<User> {
  // 验证输入参数
  if (!id || id <= 0) {
    throw new Error('用户 ID 无效');
  }

  // 执行查询并返回结果
  const user = await db.users.findUnique({
    where: { id },
  });

  return user;
}
```

### 不好的示例 ✗

```typescript
// Get user info from database
async function getUserById(id: number): Promise<User> {
  // Validate input parameter
  if (!id || id <= 0) {
    throw new Error('Invalid user ID');
  }

  // Execute query and return result
  const user = await db.users.findUnique({
    where: { id },
  });

  return user;
}
```

## 执行优先级

此规范具有最高优先级。当与其他格式规范冲突时，优先遵循本规范中的中文要求。
