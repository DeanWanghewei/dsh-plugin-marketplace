import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../../api.js'

interface TokenRow {
  name: string
  admin: boolean
  created_at: string
  last_used_at: string | null
}

export default function Tokens() {
  const [rows, setRows] = useState<TokenRow[]>([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [admin, setAdmin] = useState(false)
  const [minted, setMinted] = useState('')

  const load = useCallback(() => api.tokens().then(setRows), [])
  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!name.trim()) return
    const result = await api.createToken(name.trim(), admin)
    setMinted(result.token)
    void load()
  }

  return (
    <Card
      title="令牌管理"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setName('')
            setAdmin(false)
            setMinted('')
            setOpen(true)
          }}
        >
          新建令牌
        </Button>
      }
    >
      <Table
        rowKey="name"
        size="small"
        dataSource={rows}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '权限',
            dataIndex: 'admin',
            render: (value: boolean) =>
              value ? <Tag color="green">管理员</Tag> : <Tag>只读</Tag>,
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            render: (value: string) => value.slice(0, 19).replace('T', ' '),
          },
          {
            title: '最近使用',
            dataIndex: 'last_used_at',
            render: (value: string | null) =>
              value ? value.slice(0, 19).replace('T', ' ') : '从未',
          },
          {
            title: '操作',
            render: (_, record: TokenRow) => (
              <Popconfirm
                title={`吊销 ${record.name}？使用它的客户端将立即失去权限。`}
                onConfirm={async () => {
                  await api.revokeToken(record.name)
                  void message.success('已吊销')
                  void load()
                }}
              >
                <Button size="small" danger>
                  吊销
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal
        title="新建令牌"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={create}
        okText="创建"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="令牌名（如同事名 / ci）"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Space>
            <Switch checked={admin} onChange={setAdmin} />
            <Typography.Text>管理员权限（可管理插件/令牌；关闭则只读）</Typography.Text>
          </Space>
          {minted && (
            <Typography.Paragraph copyable={{ text: minted }} style={{ marginBottom: 0 }}>
              新令牌（仅此一次显示）：<Typography.Text code>{minted}</Typography.Text>
            </Typography.Paragraph>
          )}
        </Space>
      </Modal>
    </Card>
  )
}
