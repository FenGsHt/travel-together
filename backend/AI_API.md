# AI API 接口文档

## 认证方式

所有 AI API 接口需要在请求头中提供 API Key：

```
X-API-Key: your-api-key-here
```

API Key 通过环境变量 `AI_API_KEY` 配置。

---

## 接口列表

### 1. 批量导入旅行块

**POST** `/api/ai/projects/{project_id}/blocks`

批量导入旅行块到项目中。

**请求体：**

```json
{
  "blocks": [
    {
      "name": "建水古城",
      "image": "diannan-images/spots/建水古城.jpg",
      "description": "千年古城，保存完好的明清建筑群"
    },
    {
      "name": "元阳梯田",
      "image": "diannan-images/spots/元阳梯田.jpg",
      "description": "世界文化遗产，哈尼族梯田景观"
    }
  ]
}
```

**响应：**

```json
{
  "success": true,
  "imported": 2,
  "blocks": [
    {
      "id": "block_1725638400000_0",
      "name": "建水古城",
      "image": "diannan-images/spots/建水古城.jpg",
      "description": "千年古城，保存完好的明清建筑群"
    },
    {
      "id": "block_1725638400000_1",
      "name": "元阳梯田",
      "image": "diannan-images/spots/元阳梯田.jpg",
      "description": "世界文化遗产，哈尼族梯田景观"
    }
  ]
}
```

---

### 2. 更新行程时间线

**POST** `/api/ai/projects/{project_id}/timeline`

添加、修改或删除行程项。

**请求体（添加）：**

```json
{
  "action": "add",
  "item": {
    "blockId": "block_1725638400000_0",
    "day": 1,
    "time": "09:00",
    "note": "建议游览 2-3 小时"
  }
}
```

**请求体（修改）：**

```json
{
  "action": "update",
  "item": {
    "id": "timeline_1725638400000_0",
    "time": "10:00",
    "note": "调整到上午 10 点"
  }
}
```

**请求体（删除）：**

```json
{
  "action": "remove",
  "item": {
    "id": "timeline_1725638400000_0"
  }
}
```

**响应：**

```json
{
  "success": true,
  "action": "add",
  "timeline": [
    {
      "id": "timeline_1725638400000_0",
      "blockId": "block_1725638400000_0",
      "day": 1,
      "time": "09:00",
      "note": "建议游览 2-3 小时"
    }
  ]
}
```

---

### 3. 创建投票

**POST** `/api/ai/projects/{project_id}/polls`

创建新的投票。

**请求体：**

```json
{
  "question": "第一天住宿选择哪里？",
  "options": [
    "建水古城内民宿",
    "建水县城酒店"
  ]
}
```

**响应：**

```json
{
  "success": true,
  "poll": {
    "id": "poll_1725638400000_0",
    "question": "第一天住宿选择哪里？",
    "options": [
      "建水古城内民宿",
      "建水县城酒店"
    ],
    "votes": {},
    "createdBy": "ai",
    "createdAt": "2026-09-07T01:00:00.000000"
  }
}
```

---

### 4. 获取项目摘要

**GET** `/api/ai/projects/{project_id}/summary`

获取项目的完整信息，供 AI 分析和决策。

**响应：**

```json
{
  "id": "project_1725638400000",
  "name": "滇南 7 日游",
  "description": "探索云南南部的历史文化之旅",
  "destination": "云南·滇南",
  "startDate": "2026-10-01",
  "endDate": "2026-10-07",
  "blocks_count": 8,
  "timeline_count": 5,
  "polls_count": 1,
  "blocks": [
    {
      "id": "block_1725638400000_0",
      "name": "建水古城",
      "image": "diannan-images/spots/建水古城.jpg",
      "description": "千年古城，保存完好的明清建筑群"
    }
  ],
  "timeline": [
    {
      "id": "timeline_1725638400000_0",
      "blockId": "block_1725638400000_0",
      "day": 1,
      "time": "09:00",
      "note": "建议游览 2-3 小时"
    }
  ],
  "polls": [
    {
      "id": "poll_1725638400000_0",
      "question": "第一天住宿选择哪里？",
      "options": [
        "建水古城内民宿",
        "建水县城酒店"
      ],
      "votes": {},
      "createdBy": "ai",
      "createdAt": "2026-09-07T01:00:00.000000"
    }
  ]
}
```

---

## 错误响应

所有接口在出错时返回统一格式：

```json
{
  "error": "错误描述"
}
```

**常见错误码：**

- `400` - 请求参数错误
- `401` - API Key 无效
- `404` - 项目不存在
- `503` - AI API 未配置

---

## 使用示例

### Python 示例

```python
import requests

API_BASE = "http://150.158.110.168:5000"
API_KEY = "your-api-key-here"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

# 获取项目摘要
project_id = "project_1725638400000"
response = requests.get(
    f"{API_BASE}/api/ai/projects/{project_id}/summary",
    headers=headers
)
project = response.json()

# 批量导入旅行块
blocks = [
    {
        "name": "建水古城",
        "image": "diannan-images/spots/建水古城.jpg",
        "description": "千年古城"
    }
]
response = requests.post(
    f"{API_BASE}/api/ai/projects/{project_id}/blocks",
    headers=headers,
    json={"blocks": blocks}
)

# 添加行程项
response = requests.post(
    f"{API_BASE}/api/ai/projects/{project_id}/timeline",
    headers=headers,
    json={
        "action": "add",
        "item": {
            "blockId": "block_1725638400000_0",
            "day": 1,
            "time": "09:00"
        }
    }
)
```

### cURL 示例

```bash
# 获取项目摘要
curl -X GET "http://150.158.110.168:5000/api/ai/projects/project_1725638400000/summary" \
  -H "X-API-Key: your-api-key-here"

# 批量导入旅行块
curl -X POST "http://150.158.110.168:5000/api/ai/projects/project_1725638400000/blocks" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"blocks": [{"name": "建水古城", "image": "test.jpg"}]}'

# 创建投票
curl -X POST "http://150.158.110.168:5000/api/ai/projects/project_1725638400000/polls" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"question": "住宿选择？", "options": ["民宿", "酒店"]}'
```

---

## 注意事项

1. **API Key 安全**：不要在客户端代码中硬编码 API Key，应该通过环境变量或安全的密钥管理服务提供。

2. **幂等性**：导入接口不是幂等的，多次调用会重复添加数据。如果需要更新，请使用 update action。

3. **数据验证**：接口会进行基本的数据验证，但建议在调用前自行验证数据格式。

4. **并发控制**：当前使用文件存储，不支持并发写入。高并发场景建议使用数据库。
