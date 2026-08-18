import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Carousel,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography

interface LocalImage {
  url: string
  caption?: string
}

interface LocalPlugin {
  qualifiedId: string
  registry: string
  id: string
  name: string
  description: string
  categories: string[]
  tags: string[]
  author?: string
  license?: string
  homepage?: string
  verified: boolean
  source: { type: string; [key: string]: unknown }
  images: LocalImage[]
  installed: boolean
  origin?: 'dshm' | 'profile'
}

interface RegistryRow {
  name: string
  type: string
  location: string
  ok: boolean
  error?: string
  plugins: number
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`)
  return data as T
}

export default function LocalApp() {
  const [plugins, setPlugins] = useState<LocalPlugin[]>([])
  const [registries, setRegistries] = useState<RegistryRow[]>([])
  const [profiles, setProfiles] = useState<string[]>([])
  const [profile, setProfile] = useState('')
  const [registryFilter, setRegistryFilter] = useState<string | undefined>()
  const [statusFilter, setStatusFilter] = useState<'all' | 'installed' | 'notInstalled'>('all')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [detail, setDetail] = useState<LocalPlugin>()
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams()
      if (profile) query.set('profile', profile)
      const [list, regs, profs] = await Promise.all([
        api<{ items: LocalPlugin[] }>(`/api/local/plugins?${query.toString()}`),
        api<{ items: RegistryRow[] }>('/api/local/registries'),
        api<{ items: string[] }>('/api/local/profiles'),
      ])
      setPlugins(list.items)
      setRegistries(regs.items)
      setProfiles(profs.items)
    } catch (error) {
      void message.error(String(error))
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    void api<{ defaultProfile: string }>('/api/local/config').then((config) => {
      if (!profile) setProfile(config.defaultProfile)
    })
  }, [])
  useEffect(() => {
    if (profile) void load()
  }, [profile, load])

  const install = async (plugin: LocalPlugin, allowBuild = false) => {
    setBusyId(plugin.qualifiedId)
    try {
      const outcome = await api<{
        status: string
        keys?: string[]
        warnings?: string[]
        hints?: string[]
        error?: string
      }>('/api/local/install', {
        method: 'POST',
        body: JSON.stringify({
          qualifiedId: plugin.qualifiedId,
          profile,
          allowBuild,
          yes: true,
        }),
      })
      if (outcome.status === 'allow-builds-required' && outcome.keys) {
        Modal.confirm({
          title: '允许构建脚本？',
          content: `pnpm 要求为 ${outcome.keys.join(', ')} 显式授权构建脚本——这等于允许该包代码在你机器上执行。仅对信任来源授权。`,
          okText: '允许并继续',
          cancelText: '取消',
          onOk: () => install(plugin, true),
        })
        return
      }
      if (outcome.status === 'error') throw new Error(outcome.error ?? '安装失败')
      void message.success(
        outcome.status === 'already-installed' ? '已是安装状态' : `已安装 ${plugin.name}`,
      )
      for (const warning of outcome.warnings ?? []) void message.warning(warning)
      void load()
    } catch (error) {
      void message.error(`${plugin.name}: ${String(error)}`)
    } finally {
      setBusyId('')
    }
  }

  const uninstall = async (plugin: LocalPlugin) => {
    setBusyId(plugin.qualifiedId)
    try {
      await api('/api/local/uninstall', {
        method: 'POST',
        body: JSON.stringify({ id: plugin.qualifiedId, profile }),
      })
      void message.success(`已卸载 ${plugin.name}`)
      void load()
    } catch (error) {
      void message.error(String(error))
    } finally {
      setBusyId('')
    }
  }

  const filtered = plugins.filter((plugin) => {
    if (registryFilter && plugin.registry !== registryFilter) return false
    if (statusFilter === 'installed' && !plugin.installed) return false
    if (statusFilter === 'notInstalled' && plugin.installed) return false
    if (!q.trim()) return true
    const needle = q.trim().toLowerCase()
    return (
      plugin.id.toLowerCase().includes(needle) ||
      plugin.name.toLowerCase().includes(needle) ||
      plugin.description.toLowerCase().includes(needle) ||
      plugin.tags.some((tag) => tag.toLowerCase().includes(needle))
    )
  })

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '16px 16px 48px' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Title level={3} style={{ margin: 0 }}>
            dshm 本地控制台
            <Text type="secondary" style={{ fontSize: 13, marginLeft: 12 }}>
              聚合本机全部 marketplace · Ctrl+C 退出
            </Text>
          </Title>
          <Space wrap>
            <Select
              style={{ width: 160 }}
              placeholder="目标 profile"
              value={profile || undefined}
              onChange={setProfile}
              options={profiles.map((entry) => ({ value: entry, label: `profile: ${entry}` }))}
            />
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
              刷新
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              管理 marketplace
            </Button>
          </Space>
        </div>

        <Space wrap size="middle">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索全部市场（名称 / 描述 / 标签）"
            style={{ width: 320 }}
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          <Select
            style={{ width: 130 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'installed', label: '已安装' },
              { value: 'notInstalled', label: '未安装' },
            ]}
          />
          <Select
            allowClear
            placeholder="按 marketplace 筛选"
            style={{ minWidth: 200 }}
            value={registryFilter}
            onChange={setRegistryFilter}
            options={registries.map((entry) => ({
              value: entry.name,
              label: `${entry.name}（${entry.type}，${entry.plugins}）`,
            }))}
          />
          <Text type="secondary">{filtered.length} 个插件</Text>
        </Space>

        <Table
          rowKey="qualifiedId"
          size="small"
          loading={loading}
          dataSource={filtered}
          pagination={{ pageSize: 20, showTotal: (count) => `共 ${count} 个` }}
          onRow={(record) => ({ onClick: () => setDetail(record), style: { cursor: 'pointer' } })}
          columns={[
            {
              title: '市场',
              dataIndex: 'registry',
              width: 110,
              render: (value: string) => <Tag color="geekblue">{value}</Tag>,
            },
            {
              title: '名称',
              dataIndex: 'name',
              render: (value: string, record) => (
                <Space>
                  {value}
                  {record.verified && <SafetyCertificateOutlined style={{ color: '#52c41a' }} />}
                </Space>
              ),
            },
            { title: 'ID', dataIndex: 'id', width: 180, ellipsis: true },
            { title: '来源', dataIndex: ['source', 'type'], width: 80 },
            {
              title: '截图',
              width: 60,
              render: (_, record) => (record.images.length > 0 ? `${record.images.length} 张` : '—'),
            },
            {
              title: '状态',
              width: 90,
              render: (_, record) =>
                record.installed ? (
                  <Badge
                    status={record.origin === 'profile' ? 'warning' : 'success'}
                    text={record.origin === 'profile' ? 'profile 已有' : 'dshm 安装'}
                  />
                ) : (
                  <Badge status="default" text="未安装" />
                ),
            },
            {
              title: '操作',
              width: 130,
              render: (_, record) => (
                <Space onClick={(event) => event.stopPropagation()}>
                  {record.installed ? (
                    <Popconfirm
                      title={`从 profile「${profile}」卸载？`}
                      onConfirm={() => uninstall(record)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} loading={busyId === record.qualifiedId}>
                        卸载
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      icon={<CloudDownloadOutlined />}
                      loading={busyId === record.qualifiedId}
                      onClick={() => install(record)}
                    >
                      安装
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Space>

      <Drawer
        title={detail?.name}
        width={640}
        open={Boolean(detail)}
        onClose={() => setDetail(undefined)}
      >
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {detail.images.length > 0 && (
              <Carousel autoplay dots>
                {detail.images.map((image, index) => (
                  <div key={index}>
                    <img
                      src={image.url}
                      alt={image.caption ?? `截图 ${index + 1}`}
                      style={{ width: '100%', maxHeight: 420, objectFit: 'contain' }}
                    />
                    {image.caption && (
                      <Text type="secondary" style={{ display: 'block', textAlign: 'center' }}>
                        {image.caption}
                      </Text>
                    )}
                  </div>
                ))}
              </Carousel>
            )}
            <Paragraph type="secondary">{detail.description || '（暂无描述）'}</Paragraph>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="完整 ID">{detail.qualifiedId}</Descriptions.Item>
              <Descriptions.Item label="来源">
                <Text code>{JSON.stringify(detail.source)}</Text>
              </Descriptions.Item>
              {detail.author && (
                <Descriptions.Item label="作者">{detail.author}</Descriptions.Item>
              )}
              {detail.license && (
                <Descriptions.Item label="许可证">{detail.license}</Descriptions.Item>
              )}
              {detail.homepage && (
                <Descriptions.Item label="主页">
                  <a href={detail.homepage} target="_blank" rel="noreferrer">
                    {detail.homepage}
                  </a>
                </Descriptions.Item>
              )}
            </Descriptions>
            {detail.installed ? (
              <Button danger icon={<DeleteOutlined />} onClick={() => uninstall(detail)}>
                从 {profile} 卸载
              </Button>
            ) : (
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => install(detail)}>
                安装到 {profile}
              </Button>
            )}
          </Space>
        )}
      </Drawer>

      <RegistriesModal
        open={addOpen}
        registries={registries}
        onClose={() => setAddOpen(false)}
        onChanged={load}
      />
    </div>
  )
}

function RegistriesModal({
  open,
  registries,
  onClose,
  onChanged,
}: {
  open: boolean
  registries: RegistryRow[]
  onClose: () => void
  onChanged: () => void
}) {
  const [form, setForm] = useState({ name: '', type: 'url' as 'url' | 'git' | 'file', value: '' })
  const [spinning, setSpinning] = useState(false)

  const add = async () => {
    setSpinning(true)
    try {
      await api('/api/local/registries', { method: 'POST', body: JSON.stringify(form) })
      void message.success(`已添加 ${form.name}`)
      setForm({ name: '', type: 'url', value: '' })
      onChanged()
    } catch (error) {
      void message.error(String(error))
    } finally {
      setSpinning(false)
    }
  }

  const remove = async (name: string) => {
    await api(`/api/local/registries/${name}`, { method: 'DELETE' })
    void message.success(`已移除 ${name}`)
    onChanged()
  }

  return (
    <Modal title="marketplace 源管理" open={open} onCancel={onClose} footer={null} width={720}>
      <Spin spinning={spinning}>
        <Table
          rowKey="name"
          size="small"
          dataSource={registries}
          pagination={false}
          columns={[
            { title: '名称', dataIndex: 'name', width: 110 },
            { title: '类型', dataIndex: 'type', width: 70 },
            {
              title: '位置',
              dataIndex: 'location',
              ellipsis: true,
              render: (value: string) => (
                <Text code style={{ fontSize: 12 }}>
                  {value}
                </Text>
              ),
            },
            {
              title: '状态',
              dataIndex: 'ok',
              width: 130,
              render: (ok: boolean, record) =>
                ok ? (
                  <Badge status="success" text={`${record.plugins} 个插件`} />
                ) : (
                  <Badge status="error" text={record.error?.slice(0, 40) ?? '加载失败'} />
                ),
            },
            {
              title: '',
              width: 60,
              render: (_, record) => (
                <Popconfirm title={`移除 ${record.name}？`} onConfirm={() => remove(record.name)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />
        <Space.Compact style={{ width: '100%', marginTop: 16 }}>
          <Input
            placeholder="名称（命名空间）"
            style={{ width: 140 }}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <Select
            style={{ width: 100 }}
            value={form.type}
            onChange={(value) => setForm({ ...form, type: value })}
            options={[
              { value: 'url', label: 'http 服务' },
              { value: 'git', label: 'git 仓库' },
              { value: 'file', label: '本地文件' },
            ]}
          />
          <Input
            placeholder={form.type === 'git' ? 'https://…/repo.git' : form.type === 'file' ? '/abs/registry.yaml' : 'https://…/api/v1/export'}
            prefix={<LinkOutlined />}
            value={form.value}
            onChange={(event) => setForm({ ...form, value: event.target.value })}
          />
          <Button type="primary" disabled={!form.name.trim() || !form.value.trim()} onClick={add}>
            添加
          </Button>
        </Space.Compact>
      </Spin>
    </Modal>
  )
}
