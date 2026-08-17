import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Button,
  Card,
  Carousel,
  Col,
  Descriptions,
  message,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  CopyOutlined,
  DownloadOutlined,
  GithubOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
} from '@ant-design/icons'
import { api, type PluginView } from '../api.js'

const { Title, Paragraph, Text } = Typography

/** owner/repo from the git-source URL shapes the registry accepts. */
function githubRepo(source: PluginView['source']): string | undefined {
  if (source.type !== 'git') return undefined
  const shorthand = source.url.match(/^github:([^/]+)\/([^#]+)/)
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`
  const https = source.url.match(/github\.com[/:]([^/]+)\/([^#./]+?)(?:\.git)?$/)
  if (https) return `${https[1]}/${https[2]}`
  return undefined
}

function useGithubStars(repo: string | undefined) {
  const [stars, setStars] = useState<{ stars: number; forks: number } | undefined>()
  useEffect(() => {
    if (!repo) return
    fetch(`https://api.github.com/repos/${repo}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (data && typeof data.stargazers_count === 'number') {
          setStars({ stars: data.stargazers_count, forks: data.forks_count })
        }
      })
      .catch(() => undefined)
  }, [repo])
  return stars
}

function describeSource(source: PluginView['source']): string {
  if (source.type === 'npm') return `npm · ${source.package}`
  if (source.type === 'git') {
    return `git · ${source.url}${source.ref ? `#${source.ref}` : ''}${source.subdir ? ` · ${source.subdir}` : ''}`
  }
  return `path · ${source.path}`
}

export default function PluginDetail() {
  const { id } = useParams()
  const [plugin, setPlugin] = useState<PluginView>()
  const [loading, setLoading] = useState(true)
  const repo = plugin ? githubRepo(plugin.source) : undefined
  const github = useGithubStars(repo)

  useEffect(() => {
    setLoading(true)
    if (!id) return
    void api
      .getPlugin(id)
      .then(setPlugin)
      .catch(() => setPlugin(undefined))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin />
      </div>
    )
  }
  if (!plugin) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Paragraph>插件不存在</Paragraph>
        <Link to="/">返回市场</Link>
      </div>
    )
  }

  const installCommand = `dshm install ${plugin.id}`

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space>
          <Link to="/">
            <Button icon={<ArrowLeftOutlined />}>返回市场</Button>
          </Link>
        </Space>

        <Card>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Title level={3} style={{ marginBottom: 0 }}>
              <Space>
                {plugin.name}
                {plugin.verified && <SafetyCertificateOutlined style={{ color: '#52c41a' }} />}
              </Space>
            </Title>
            <Space wrap>
              {plugin.categories.map((entry) => (
                <Tag key={entry}>{entry}</Tag>
              ))}
              {plugin.tags.map((entry) => (
                <Tag key={entry} color="blue">
                  {entry}
                </Tag>
              ))}
              <Text type="secondary">
                <DownloadOutlined /> {plugin.downloads} 次安装
              </Text>
              {github && (
                <Text type="secondary">
                  <GithubOutlined /> {repo} · <StarOutlined /> {github.stars} · fork{' '}
                  {github.forks}
                </Text>
              )}
            </Space>
            <Paragraph style={{ marginBottom: 0 }}>{plugin.description || '（暂无描述）'}</Paragraph>
          </Space>
        </Card>

        {plugin.images.length > 0 && (
          <Card title="演示截图">
            <Carousel autoplay dots>
              {plugin.images.map((image, index) => (
                <div key={index}>
                  <img
                    src={image.url}
                    alt={image.caption ?? `${plugin.name} 截图 ${index + 1}`}
                    style={{ width: '100%', maxHeight: 480, objectFit: 'contain' }}
                  />
                  {image.caption && (
                    <Text type="secondary" style={{ display: 'block', textAlign: 'center' }}>
                      {image.caption}
                    </Text>
                  )}
                </div>
              ))}
            </Carousel>
          </Card>
        )}

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Card title="安装" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Button
                    type="primary"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      void navigator.clipboard.writeText(installCommand)
                      void message.success('已复制安装命令')
                    }}
                  >
                    复制安装命令
                  </Button>
                </Space.Compact>
                <Text code style={{ fontSize: 13 }}>
                  {installCommand}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  还没有 dshm？先执行 <Text code>npm i -g dshm-cli</Text>，再运行上面的命令；
                  也可先 <Link to="/admin">添加本市场</Link> 后安装。
                </Text>
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="元数据" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="ID">{plugin.id}</Descriptions.Item>
                <Descriptions.Item label="来源">{describeSource(plugin.source)}</Descriptions.Item>
                {plugin.author && (
                  <Descriptions.Item label="作者">{plugin.author}</Descriptions.Item>
                )}
                {plugin.license && (
                  <Descriptions.Item label="许可证">{plugin.license}</Descriptions.Item>
                )}
                {plugin.homepage && (
                  <Descriptions.Item label="主页">
                    <a href={plugin.homepage} target="_blank" rel="noreferrer">
                      {plugin.homepage}
                    </a>
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>
          </Col>
        </Row>
      </Space>
    </div>
  )
}
