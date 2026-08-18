import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { api, type CategoryView, type PluginImage, type PluginView } from '../../api.js'

const { Text } = Typography

interface FormValues {
  id: string
  name: string
  description: string
  categories: string[]
  tags: string
  author: string
  homepage: string
  license: string
  verified: boolean
  sourceType: 'npm' | 'git' | 'path'
  npmPackage: string
  gitUrl: string
  gitRef: string
  gitSubdir: string
  gitPrivate: boolean
  pathValue: string
  pathLink: boolean
  images: PluginImage[]
}

function toFormValues(plugin: PluginView): FormValues {
  const source = plugin.source
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    categories: plugin.categories,
    tags: plugin.tags.join(', '),
    author: plugin.author ?? '',
    homepage: plugin.homepage ?? '',
    license: plugin.license ?? '',
    verified: plugin.verified,
    sourceType: source.type,
    npmPackage: source.type === 'npm' ? source.package : '',
    gitUrl: source.type === 'git' ? source.url : '',
    gitRef: source.type === 'git' ? (source.ref ?? '') : '',
    gitSubdir: source.type === 'git' ? (source.subdir ?? '') : '',
    gitPrivate: source.type === 'git' ? (source.private ?? false) : false,
    pathValue: source.type === 'path' ? source.path : '',
    pathLink: source.type === 'path' ? (source.link ?? false) : false,
    images: plugin.images,
  }
}

function buildPayload(values: FormValues) {
  const source =
    values.sourceType === 'npm'
      ? { type: 'npm' as const, package: values.npmPackage }
      : values.sourceType === 'git'
        ? {
            type: 'git' as const,
            url: values.gitUrl,
            ref: values.gitRef || undefined,
            subdir: values.gitSubdir || undefined,
            private: values.gitPrivate || undefined,
          }
        : { type: 'path' as const, path: values.pathValue, link: values.pathLink || undefined }
  return {
    name: values.name,
    description: values.description ?? '',
    categories: values.categories ?? [],
    tags: values.tags
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    author: values.author || undefined,
    homepage: values.homepage || undefined,
    license: values.license || undefined,
    verified: values.verified,
    source,
    images: values.images ?? [],
  }
}

export default function Plugins() {
  const [items, setItems] = useState<PluginView[]>([])
  const [categories, setCategories] = useState<CategoryView[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PluginView>()
  const [form] = Form.useForm<FormValues>()

  const load = useCallback(async () => {
    const result = await api.listPlugins({ limit: 500, offset: 0 })
    setItems(result.items)
  }, [])
  useEffect(() => {
    void load()
    void api.categories().then(setCategories)
  }, [load])

  const openForm = (plugin?: PluginView) => {
    setEditing(plugin)
    form.resetFields()
    form.setFieldsValue(
      plugin
        ? toFormValues(plugin)
        : {
            id: '',
            name: '',
            description: '',
            categories: [],
            tags: '',
            verified: false,
            sourceType: 'npm',
            images: [],
          },
    )
    setOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    try {
      await api.upsertPlugin(values.id, buildPayload(values))
      void message.success('已保存')
      setOpen(false)
      void load()
    } catch (error) {
      void message.error(String(error))
    }
  }

  const remove = async (id: string) => {
    await api.deletePlugin(id)
    void message.success('已删除')
    void load()
  }

  return (
    <Card
      title="插件管理"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>
          新建插件
        </Button>
      }
    >
      <Table
        rowKey="id"
        size="small"
        dataSource={items}
        pagination={{
          defaultPageSize: 15,
          showSizeChanger: true,
          pageSizeOptions: [15, 30, 50, 100],
          showTotal: (count) => `共 ${count} 个`,
        }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 180 },
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
          { title: '来源', dataIndex: ['source', 'type'], width: 80 },
          { title: '截图', render: (_, record) => `${record.images.length} 张`, width: 70 },
          { title: '安装', dataIndex: 'downloads', width: 70 },
          {
            title: '操作',
            width: 130,
            render: (_, record) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openForm(record)}>
                  编辑
                </Button>
                <Popconfirm title={`删除 ${record.id}？`} onConfirm={() => remove(record.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑 ${editing.id}` : '新建插件'}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="id"
              label="ID（小写 slug）"
              rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9-]*$/, message: '小写字母数字连字符' }]}
              style={{ width: 220 }}
            >
              <Input disabled={Boolean(editing)} placeholder="my-plugin" />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true }]} style={{ width: 320 }}>
              <Input />
            </Form.Item>
            <Form.Item name="verified" label="已验证" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Space size="middle" style={{ display: 'flex' }} wrap>
            <Form.Item name="categories" label="分类（可多选）" style={{ minWidth: 280 }}>
              <Select
                mode="multiple"
                allowClear
                options={categories.map((entry) => ({
                  value: entry.id,
                  label: entry.name.zh ?? entry.name.en ?? entry.id,
                }))}
              />
            </Form.Item>
            <Form.Item name="tags" label="标签（逗号分隔）" style={{ width: 280 }}>
              <Input placeholder="tool, cordis" />
            </Form.Item>
          </Space>

          <Space size="middle" style={{ display: 'flex' }} wrap>
            <Form.Item name="author" label="作者" style={{ width: 180 }}>
              <Input />
            </Form.Item>
            <Form.Item name="license" label="许可证" style={{ width: 120 }}>
              <Input />
            </Form.Item>
            <Form.Item name="homepage" label="主页" style={{ width: 280 }}>
              <Input />
            </Form.Item>
          </Space>

          <Form.Item name="sourceType" label="来源类型" rules={[{ required: true }]} style={{ width: 160 }}>
            <Select
              options={[
                { value: 'npm', label: 'npm 包' },
                { value: 'git', label: 'git 仓库' },
                { value: 'path', label: '本地路径' },
              ]}
            />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, next) => prev.sourceType !== next.sourceType}>
            {() => {
              const type = Form.useWatch('sourceType', form)
              return (
                <>
                  {type === 'npm' && (
                    <Form.Item name="npmPackage" label="npm 包名" rules={[{ required: true }]}>
                      <Input placeholder="@deepseek-ai/dsh-tool-cordis" />
                    </Form.Item>
                  )}
                  {type === 'git' && (
                    <Space size="middle" style={{ display: 'flex' }} wrap>
                      <Form.Item name="gitUrl" label="仓库地址" rules={[{ required: true }]}>
                        <Input placeholder="github:you/repo 或 git+ssh://…" style={{ width: 420 }} />
                      </Form.Item>
                      <Form.Item name="gitRef" label="ref（建议固定）">
                        <Input style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item name="gitSubdir" label="子目录">
                        <Input style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item name="gitPrivate" label="私有" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Space>
                  )}
                  {type === 'path' && (
                    <Space size="middle" style={{ display: 'flex' }}>
                      <Form.Item name="pathValue" label="路径" rules={[{ required: true }]}>
                        <Input placeholder="/abs/path/to/plugin" style={{ width: 420 }} />
                      </Form.Item>
                      <Form.Item name="pathLink" label="link 模式" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Space>
                  )}
                </>
              )
            }}
          </Form.Item>

          <Form.Item
            label={
              <Text>
                演示截图（https URL —— GitHub 附件图、S3 代理地址均可，拖动排序无效请用 ↑↓）
              </Text>
            }
          >
            <Form.List name="images">
              {(fields, { add, remove, move }) => (
                <>
                  {fields.map((field, index) => (
                    <Space key={field.key} style={{ display: 'flex' }} align="start">
                      <Form.Item
                        name={[field.name, 'url']}
                        rules={[{ required: true, type: 'url' }]}
                        style={{ width: 420 }}
                      >
                        <Input placeholder="https://…/screenshot.png" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'caption']} style={{ width: 240 }}>
                        <Input placeholder="说明（可选）" />
                      </Form.Item>
                      <Space.Compact>
                        <Button
                          size="small"
                          disabled={index === 0}
                          onClick={() => move(index, index - 1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="small"
                          disabled={index === fields.length - 1}
                          onClick={() => move(index, index + 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => remove(field.name)}
                        />
                      </Space.Compact>
                      <ImagePreview index={index} />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    onClick={() => add({})}
                  >
                    添加截图 URL
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

/** Tiny thumbnail next to each image row so the URL is verifiable at a glance. */
function ImagePreview({ index }: { index: number }) {
  const images = Form.useWatch('images')
  const url = images?.[index]?.url
  if (!url || !/^https?:\/\//.test(url)) return null
  return (
    <img
      src={url}
      alt=""
      style={{ height: 40, borderRadius: 4, border: '1px solid #eee' }}
    />
  )
}
