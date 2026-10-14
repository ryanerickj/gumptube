// Gumptube — tela de escolha da solução.
(() => {
  const GT = (window.GT = window.GT || {});
  GT.views = GT.views || {};
  const { el } = GT;

  GT.views.launcher = {
    create(ctx) {
      const remember = el('input', { type: 'checkbox' });
      GT.store.get('gt:always', false).then((value) => { remember.checked = !!value; });

      const cards = GT.SOLUTIONS.map((solution) =>
        el('button', {
          class: 'gt-launch',
          'data-id': solution.id,
          style: { '--gt-accent': solution.accent },
          onclick: async () => {
            await GT.store.set('gt:always', remember.checked);
            await GT.store.set('gt:solution', solution.id);
            ctx.go(solution.id);
          }
        },
          el('span', { class: 'gt-launch-icon', html: solution.icon }),
          el('span', { class: 'gt-launch-text' },
            el('b', {}, solution.name),
            el('i', {}, solution.tagline),
            el('span', {}, solution.description)
          ),
          el('span', { class: 'gt-launch-go', html: '&rsaquo;' })
        )
      );

      return {
        el: el('div', { class: 'gt-launcher' },
          el('p', { class: 'gt-launch-lead' },
            'Escolha por onde começar. Os ícones no topo trocam de solução em 1 clique, e o ⌂ traz você de volta para cá.'),
          cards,
          el('label', { class: 'gt-remember' },
            remember,
            el('span', {}, 'Abrir sempre nesta solução, sem passar por aqui')
          ),
          el('p', { class: 'gt-note' },
            'Dica: passe o mouse sobre qualquer thumbnail do YouTube para copiar a imagem em alta, sem abrir o vídeo.')
        )
      };
    }
  };
})();
