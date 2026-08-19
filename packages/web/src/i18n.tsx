import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Minimal i18n: React context + zh/en dictionaries + AntD locale wiring.
 * No dependency; persistence in localStorage; defaults to navigator language.
 */

export type Lang = 'zh' | 'en'

const DICT: Record<Lang, Record<string, string>> = {
  zh: {
    'app.title': 'dshm 本地控制台',
    'app.subtitle': '聚合本机全部 marketplace · Ctrl+C 退出',
    'app.profile': '目标 profile',
    'app.refresh': '刷新',
    'app.manageSources': '管理 marketplace',
    'tab.detail': '插件明细',
    'tab.groups': '插件分组',
    'tab.market': '按市场浏览',
    'tab.category': '按功能分类',
    'search.placeholder': '搜索全部市场（名称 / 描述 / 标签）',
    'filter.all': '全部状态',
    'filter.installed': '已安装',
    'filter.notInstalled': '未安装',
    'filter.marketplace': '按 marketplace 筛选',
    'filter.category': '按功能分类筛选',
    'category.viewAll': '查看全部 »',
    'filter.count': '{n} 个插件',
    'col.market': '市场',
    'col.name': '名称',
    'col.id': 'ID',
    'col.source': '来源',
    'col.screenshots': '截图',
    'col.status': '状态',
    'col.actions': '操作',
    'status.profileOwned': 'profile 已有',
    'status.dshmInstalled': 'dshm 安装',
    'status.disabled': '已停用',
    'status.notInstalled': '未安装',
    'action.install': '安装',
    'action.uninstall': '卸载',
    'action.enable': '启用',
    'action.disable': '停用',
    'action.uninstallConfirm': '从 profile「{profile}」卸载？',
    'groups.new': '新建分组',
    'groups.import': '导入分组',
    'groups.summary': '{n} 个分组 · 同事可 export 分享后一键整套安装',
    'groups.members': '{n} 个插件',
    'groups.noDescription': '（无描述）',
    'groups.installAll': '整组安装',
    'groups.copyShare': '复制分享',
    'groups.deleteConfirm': '删除分组 {name}？',
    'groups.namePlaceholder': '分组名（如 team-kit）',
    'groups.descPlaceholder': '描述（这套是干什么用的）',
    'groups.idsPlaceholder': '插件 id，逗号或换行分隔：\ntool-cordis, skill\ntimer',
    'groups.save': '保存',
    'groups.importTitle': '导入分组（粘贴分享的 YAML）',
    'groups.importOk': '导入',
    'groups.applied': '组 {name}: {ok}/{total} 应用成功',
    'groups.copied': '组 YAML 已复制到剪贴板',
    'config.title': '{name} — 配置并启用',
    'config.hint':
      '此插件需要配置才能启动。填写 YAML 格式的配置（注入到 cordis.patch.yml 行的 config: 下），保存后自动启用，运行中的 dsh 热加载生效。',
    'config.saveEnable': '保存并启用',
    'detail.installTitle': '安装',
    'detail.copyCmd': '复制安装命令',
    'detail.copied': '已复制安装命令',
    'detail.metadata': '元数据',
    'detail.dependencies': '依赖插件',
    'detail.services': '所需服务',
    'detail.installTo': '安装到 {profile}',
    'detail.uninstallFrom': '从 {profile} 卸载',
    'detail.noDescription': '（暂无描述）',
    'category.other': '其他',
    'category.infrastructure': '基础设施',
    'category.agent-tool': '智能体工具',
    'category.ui': '界面 / UI',
    'category.extension': '扩展',
    'category.bundle': '组合包',
    'category.sdk': 'SDK',
    'category.adapter': '模型适配',
    'category.example': '示例',
    'category.pick': '精选',
    'category.community': '社区',
    'category.browser': '浏览器 / 搜索',
    'category.skill': '技能管理',
    'category.workflow': '工作流',
    'category.tools': '工具',
    'category.dev': '开发',
    'category.usage': '使用分析',
    'category.theme': '主题',
    'install.allowBuildTitle': '允许构建脚本？',
    'install.allowBuildOk': '允许并继续',
    'install.cancel': '取消',
    'sources.title': 'marketplace 源管理',
    'sources.name': '名称（命名空间）',
    'sources.type': '类型',
    'sources.location': '位置',
    'sources.state': '状态',
    'sources.loadOk': '{n} 个插件',
    'sources.loadFail': '加载失败',
    'sources.add': '添加',
    'sources.removeConfirm': '移除 {name}？',
    'lang.zh': '中文',
    'lang.en': 'English',
    'theme.system': '跟随系统',
    'theme.light': '浅色',
    'theme.dark': '深色',
  },
  en: {
    'app.title': 'dshm local console',
    'app.subtitle': 'All local marketplaces · Ctrl+C to exit',
    'app.profile': 'profile',
    'app.refresh': 'Refresh',
    'app.manageSources': 'Manage sources',
    'tab.detail': 'Plugins',
    'tab.groups': 'Groups',
    'tab.market': 'By marketplace',
    'tab.category': 'By category',
    'search.placeholder': 'Search all marketplaces (name / description / tags)',
    'filter.all': 'All',
    'filter.installed': 'Installed',
    'filter.notInstalled': 'Not installed',
    'filter.marketplace': 'Filter by marketplace',
    'filter.category': 'Filter by category',
    'category.viewAll': 'View all »',
    'filter.count': '{n} plugins',
    'col.market': 'Market',
    'col.name': 'Name',
    'col.id': 'ID',
    'col.source': 'Source',
    'col.screenshots': 'Shots',
    'col.status': 'Status',
    'col.actions': 'Actions',
    'status.profileOwned': 'in profile',
    'status.dshmInstalled': 'via dshm',
    'status.disabled': 'Disabled',
    'status.notInstalled': 'Not installed',
    'action.install': 'Install',
    'action.uninstall': 'Uninstall',
    'action.enable': 'Enable',
    'action.disable': 'Disable',
    'action.uninstallConfirm': 'Uninstall from profile "{profile}"?',
    'groups.new': 'New group',
    'groups.import': 'Import group',
    'groups.summary': '{n} groups · share via export, teammates install in one go',
    'groups.members': '{n} plugins',
    'groups.noDescription': '(no description)',
    'groups.installAll': 'Install all',
    'groups.copyShare': 'Copy share',
    'groups.deleteConfirm': 'Delete group {name}?',
    'groups.namePlaceholder': 'group name (e.g. team-kit)',
    'groups.descPlaceholder': 'what this set is for',
    'groups.idsPlaceholder': 'plugin ids, comma or newline separated:\ntool-cordis, skill\ntimer',
    'groups.save': 'Save',
    'groups.importTitle': 'Import group (paste shared YAML)',
    'groups.importOk': 'Import',
    'groups.applied': 'Group {name}: {ok}/{total} applied',
    'groups.copied': 'Group YAML copied to clipboard',
    'config.title': '{name} — configure & enable',
    'config.hint':
      'This plugin needs config to start. YAML below is injected into the row’s config: in cordis.patch.yml; enabling is automatic and a running dsh hot-reloads it.',
    'config.saveEnable': 'Save & enable',
    'detail.installTitle': 'Install',
    'detail.copyCmd': 'Copy install command',
    'detail.copied': 'Install command copied',
    'detail.metadata': 'Metadata',
    'detail.dependencies': 'Requires',
    'detail.services': 'Services',
    'detail.installTo': 'Install to {profile}',
    'detail.uninstallFrom': 'Uninstall from {profile}',
    'detail.noDescription': '(no description)',
    'category.other': 'Other',
    'category.infrastructure': 'Infrastructure',
    'category.agent-tool': 'Agent tools',
    'category.ui': 'UI',
    'category.extension': 'Extensions',
    'category.bundle': 'Bundles',
    'category.sdk': 'SDK',
    'category.adapter': 'Model adapters',
    'category.example': 'Examples',
    'category.pick': 'Picks',
    'category.community': 'Community',
    'category.browser': 'Browser / Search',
    'category.skill': 'Skills',
    'category.workflow': 'Workflow',
    'category.tools': 'Tools',
    'category.dev': 'Dev',
    'category.usage': 'Usage',
    'category.theme': 'Theme',
    'install.allowBuildTitle': 'Allow build scripts?',
    'install.allowBuildOk': 'Allow & continue',
    'install.cancel': 'Cancel',
    'sources.title': 'Marketplace sources',
    'sources.name': 'name (namespace)',
    'sources.type': 'type',
    'sources.location': 'location',
    'sources.state': 'status',
    'sources.loadOk': '{n} plugins',
    'sources.loadFail': 'failed',
    'sources.add': 'Add',
    'sources.removeConfirm': 'Remove {name}?',
    'lang.zh': '中文',
    'lang.en': 'English',
    'theme.system': 'System',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
  },
}

type TFunc = (key: string, params?: Record<string, string | number>) => string

interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TFunc
}

const I18nContext = createContext<I18n>({
  lang: 'zh',
  setLang: () => undefined,
  t: (key) => key,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('dshm_lang')
    if (saved === 'zh' || saved === 'en') return saved
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  })
  const setLang = (next: Lang): void => {
    setLangState(next)
    localStorage.setItem('dshm_lang', next)
  }
  const t: TFunc = (key, params) => {
    let text = DICT[lang][key] ?? DICT.zh[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  return useContext(I18nContext)
}

export const antdLocale = (lang: Lang): { DatePicker: { locale: string } } | Record<string, never> =>
  // The console barely uses locale-sensitive components; zh_CN/en_US come from
  // the entry file to keep this module dependency-free.
  lang === 'zh' ? { } : { }
