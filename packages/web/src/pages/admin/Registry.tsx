import { useEffect, useState } from 'react'
import { Button, Card, Input, Radio, Space, Typography, message } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { api } from '../../api.js'

const { Text } = Typography

export default function RegistryPage() {
  const [exported, setExported] = useState('')
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'replace' | 'merge'>('merge')

  useEffect(() => {
    void api.exportYaml().then(setExported)
  }, [])

  const download = () => {
    const blob = new Blob([exported], { type: 'application/yaml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'registry.yaml'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const runImport = async () => {
    try {
      const result = await api.importRegistry(draft, mode)
      void message.success(`已导入 ${result.plugins} 个插件（${mode}）`)
      void api.exportYaml().then(setExported)
    } catch (error) {
      void message.error(String(error))
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card
        title="导入 registry.yaml"
        extra={
          <Radio.Group
            value={mode}
            onChange={(event) => setMode(event.target.value as 'replace' | 'merge')}
          >
            <Radio.Button value="merge">合并（保留已有）</Radio.Button>
            <Radio.Button value="replace">替换（清空后导入）</Radio.Button>
          </Radio.Group>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea
            rows={10}
            placeholder="粘贴 registry.yaml 内容（schemaVersion: 1 …）"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="primary" icon={<UploadOutlined />} disabled={!draft.trim()} onClick={runImport}>
            执行导入
          </Button>
        </Space>
      </Card>

      <Card
        title="导出当前 registry"
        extra={
          <Button icon={<DownloadOutlined />} onClick={download}>
            下载 YAML
          </Button>
        }
      >
        <Text type="secondary">
          这份文档即 CLI 直接消费的 registry.yaml（<Text code>dshm registry add … --url
          …/api/v1/export</Text>）。
        </Text>
        <Input.TextArea readOnly rows={12} value={exported} style={{ marginTop: 8 }} />
      </Card>
    </Space>
  )
}
