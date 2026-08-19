import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme as antdTheme, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { I18nProvider, useI18n } from '../i18n.js'
import { ThemeProvider, useTheme } from '../theme.js'
import LocalApp from './App.js'

function Root(): React.ReactElement {
  const { lang } = useI18n()
  const { resolved } = useTheme()
  return (
    <ConfigProvider
      locale={lang === 'zh' ? zhCN : enUS}
      theme={{ algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      <AntApp>
        <LocalApp />
      </AntApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <Root />
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
