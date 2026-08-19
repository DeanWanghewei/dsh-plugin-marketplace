import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Col, Input, message, Pagination, Row, Select, Space, Tag, Typography } from 'antd'
import { SafetyCertificateOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons'
import { api, type CategoryView, type PluginView, type ServerGroup } from '../api.js'

const { Title, Paragraph, Text } = Typography

export default function Market() {
  const [items, setItems] = useState<PluginView[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(24)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<string | undefined>()
  const [categories, setCategories] = useState<CategoryView[]>([])
  const [groups, setGroups] = useState<ServerGroup[]>([])

  const load = useCallback(async () => {
    const result = await api.listPlugins({
      q: q || undefined,
      category,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })
    setItems(result.items)
    setTotal(result.total)
  }, [q, category, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    void api.categories().then(setCategories)
    void api.groups().then((g) => setGroups(g.items)).catch(() => undefined)
  }, [])

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Title level={2} style={{ marginBottom: 4 }}>
            dshm 插件市场
          </Title>
          <Text type="secondary">
            deepseek-harness 插件目录 · 浏览、搜索、一键安装 · <a href="/admin">管理入口</a>
          </Text>
        </div>

        <Space wrap size="middle">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索插件（名称 / 描述 / 标签）"
            style={{ width: 320 }}
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="按分类筛选"
            style={{ minWidth: 180 }}
            value={category}
            onChange={(value) => {
              setCategory(value)
              setPage(1)
            }}
            options={categories.map((entry) => ({
              value: entry.id,
              label: `${entry.name.zh ?? entry.name.en ?? entry.id}（${entry.count}）`,
            }))}
          />
        </Space>

        {groups.length > 0 && (
          <Card size="small" title="插件分组 · 一键整套安装">
            <Row gutter={[8, 8]}>
              {groups.map((group) => (
                <Col xs={24} sm={12} md={8} key={group.name}>
                  <Card
                    size="small"
                    title={group.name}
                    extra={<Text type="secondary">{group.plugins.length} 个</Text>}
                  >
                    <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ minHeight: 36 }}>
                      {group.description || '（无描述）'}
                    </Paragraph>
                    <Space wrap size={[4, 4]}>
                      {group.plugins.slice(0, 4).map((id) => (
                        <Tag key={id}>{id}</Tag>
                      ))}
                      {group.plugins.length > 4 && <Tag>+{group.plugins.length - 4}</Tag>}
                    </Space>
                    <Button
                      size="small"
                      type="primary"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          `# 逐个安装：\n${group.plugins.map((id) => `dshm install ${id}`).join('\n')}`,
                        )
                        void message.success('安装命令已复制（逐行执行）')
                      }}
                    >
                      复制安装命令
                    </Button>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        )}

        <Row gutter={[16, 16]}>
          {items.map((plugin) => (
            <Col key={plugin.id} xs={24} sm={12} md={8} lg={6}>
              <Link to={`/p/${plugin.id}`}>
                <Card
                  hoverable
                  size="small"
                  title={
                    <Space>
                      <span>{plugin.name}</span>
                      {plugin.verified && (
                        <SafetyCertificateOutlined style={{ color: '#52c41a' }} />
                      )}
                    </Space>
                  }
                  extra={<Text type="secondary">{plugin.id}</Text>}
                  style={{ height: '100%' }}
                >
                  <Paragraph ellipsis={{ rows: 3 }} type="secondary" style={{ marginBottom: 8 }}>
                    {plugin.description || '（暂无描述）'}
                  </Paragraph>
                  <Space wrap size={[4, 4]}>
                    {plugin.categories.slice(0, 3).map((entry) => (
                      <Tag key={entry}>{entry}</Tag>
                    ))}
                  </Space>
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary">
                      <DownloadOutlined /> {plugin.downloads}
                    </Text>
                  </div>
                </Card>
              </Link>
            </Col>
          ))}
        </Row>

        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger
          pageSizeOptions={[12, 24, 48, 96]}
          showTotal={(count) => `共 ${count} 个插件`}
          onChange={(nextPage, nextSize) => {
            if (nextSize !== pageSize) {
              setPageSize(nextSize)
              setPage(1)
            } else {
              setPage(nextPage)
            }
          }}
          style={{ textAlign: 'center' }}
        />
      </Space>
    </div>
  )
}
