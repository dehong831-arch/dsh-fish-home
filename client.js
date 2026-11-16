// Zero-build settings entry. The room itself is an independent same-origin page.
window.__ModuleLoader__.load({
  id: 'dsh-fish-home',
  factory: (require) => {
    const React = require('react')
    const PANEL_URL = '/plugins/dsh-fish-home/panel'

    function FishHomeSettings() {
      return React.createElement(
        'div',
        { style: { width: '100%', padding: '4px 0 18px' } },
        React.createElement(
          'p',
          { style: { margin: '0 0 12px', fontSize: '13px', lineHeight: 1.7 } },
          '把真实发生过的日常，慢慢摆进大肥鱼的小窝。',
          ' ',
          React.createElement(
            'a',
            { href: PANEL_URL, target: '_blank', rel: 'noopener' },
            '单独打开小窝',
          ),
        ),
        React.createElement('iframe', {
          src: PANEL_URL,
          title: '鱼的日常 · 小窝',
          loading: 'lazy',
          style: {
            display: 'block',
            width: '100%',
            height: 'min(880px, 85vh)',
            minHeight: '480px',
            border: '1px solid rgba(158, 115, 79, .26)',
            borderRadius: '20px',
            background: '#faf6ed',
          },
        }),
      )
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'fish-home', label: '小窝', order: 20 },
          FishHomeSettings,
        ),
      )
    }
    return { name: 'fish-home', apply, inject }
  },
})
