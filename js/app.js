/* Viva Haven | app.js (vanilla) */

(function () {
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const normalizeText = (value) => {
    let text = String(value || '').toLowerCase();

    // Evita regex \p{...} (Unicode property escapes), que pode quebrar em alguns browsers.
    // NFD separa acentos em marcas combinantes (U+0300..U+036F), removidas via regex simples.
    if (typeof text.normalize === 'function') {
      text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    return text.replace(/\s+/g, ' ').trim();
  };

  const modulesData = [
    {
      id: 1,
      title: 'Governança e Administração',
      description: 'Cadastros, regras, mandatos, procurações e assembleias digitais.',
      groups: [
        {
          title: 'Administração',
          items: [
            'Cadastro completo do condomínio (CNPJ, convenção, regimento, frações ideais)',
            'Cadastro de torres, blocos, unidades, vagas, depósitos',
            'Cadastro de síndico, subsíndico, conselho',
            'Histórico de mandatos',
            'Registro digital de convenção e regimento interno',
            'Controle de procurações',
          ],
        },
        {
          title: 'Assembleias',
          items: [
            'Convocação digital',
            'Confirmação de presença',
            'Votação online (quando permitido)',
            'Registro de quórum automático',
            'Gravação e arquivamento da assembleia',
            'Geração automática de ata',
            'Assinatura digital de ata',
            'Histórico de assembleias com busca por assunto',
          ],
        },
      ],
    },
    {
      id: 2,
      title: 'Financeiro Completo',
      description: 'Receitas, inadimplência, despesas e relatórios com visão executiva.',
      groups: [
        {
          title: 'Receitas',
          items: [
            'Geração de boletos',
            'Pix automático com conciliação',
            'Taxas extras',
            'Fundo de reserva',
            'Fundo de obras',
            'Rateios automáticos',
            'Acordos de pagamento',
          ],
        },
        {
          title: 'Inadimplência',
          items: [
            'Lista automática de inadimplentes',
            'Juros e multas automáticas',
            'Geração de carta de cobrança',
            'Negativação (integração com serviços externos)',
            'Envio automático para jurídico',
          ],
        },
        {
          title: 'Despesas',
          items: [
            'Contas a pagar',
            'Lançamento de notas fiscais',
            'Anexar comprovantes',
            'Agendamento de pagamentos',
            'Aprovação em dois níveis (gestor + conselho)',
          ],
        },
        {
          title: 'Relatórios',
          items: [
            'Balancete mensal automático',
            'Fluxo de caixa',
            'Previsão orçamentária vs realizado',
            'Despesas por centro de custo',
            'Gráficos de evolução de gastos',
            'Prestação de contas pronta para assembleia',
          ],
        },
      ],
    },
    {
      id: 3,
      title: 'Manutenção Predial',
      description: 'Preventiva e corretiva com agenda, SLA, evidências e ativos.',
      groups: [
        {
          title: 'Preventiva',
          items: [
            'Plano anual de manutenção',
            'Agenda automática de revisões',
            'Alertas de vencimento de manutenções',
            'Checklists por tipo de equipamento',
            'Histórico de manutenções',
          ],
        },
        {
          title: 'Corretiva',
          items: [
            'Abertura de chamado interno',
            'Classificação por urgência',
            'Controle de SLA',
            'Registro de fotos antes/depois',
            'Custo por manutenção',
          ],
        },
        {
          title: 'Equipamentos/Ativos',
          items: [
            'Cadastro de ativos (Elevadores, Bombas, Portões, CFTV, Gerador, SPDA, Gás, Piscina, Iluminação)',
            'Registro de garantia',
            'Registro de contratos vinculados',
          ],
        },
      ],
    },
    {
      id: 4,
      title: 'Segurança e Ocorrências',
      description: 'Controle de acesso, registros com mídia e resposta rápida.',
      groups: [
        {
          title: 'Ocorrências e Acesso',
          items: [
            'Registro de ocorrências (furtos, danos, conflitos)',
            'Anexar imagens e vídeos',
            'Livro digital de ocorrências da portaria',
            'Controle de acesso de visitantes',
            'Cadastro de prestadores de serviço',
            'Histórico de entradas e saídas',
            'Botão de emergência para o gestor',
          ],
        },
      ],
    },
    {
      id: 5,
      title: 'Obras e Reformas',
      description: 'Planejamento, aprovações, medições e histórico por unidade.',
      groups: [
        {
          title: 'Áreas Comuns',
          items: [
            'Planejamento de obras',
            'Cronograma físico-financeiro',
            'Controle de medições',
            'Registro fotográfico da evolução',
            'Aprovação de etapas',
          ],
        },
        {
          title: 'Unidades',
          items: [
            'Solicitação de reforma pelo morador',
            'Envio de documentos obrigatórios',
            'Upload de ART/RRT',
            'Aprovação/reprovação pelo gestor',
            'Histórico da obra daquela unidade',
          ],
        },
      ],
    },
    {
      id: 6,
      title: 'Gestão de Moradores',
      description: 'Cadastros, documentos, regras de convivência e reservas.',
      groups: [
        {
          title: 'Cadastros e Rotina',
          items: [
            'Cadastro de proprietários',
            'Cadastro de inquilinos',
            'Documentos das unidades',
            'Histórico de comunicação com o morador',
            'Registro de advertências e multas',
            'Controle de pets',
            'Controle de veículos',
            'Reservas de áreas comuns',
          ],
        },
      ],
    },
    {
      id: 7,
      title: 'Multas, Advertências e Convivência',
      description: 'Infrações com evidências, escalonamento e histórico disciplinar.',
      groups: [
        {
          title: 'Disciplina',
          items: [
            'Registro de infrações',
            'Envio de advertência automática',
            'Escalonamento para multa',
            'Anexar provas (foto, vídeo, relato)',
            'Histórico disciplinar por unidade',
          ],
        },
      ],
    },
    {
      id: 8,
      title: 'Comunicação',
      description: 'Comunicados, enquetes, confirmação de leitura e documentos.',
      groups: [
        {
          title: 'Canais',
          items: [
            'Mural de avisos digital',
            'Envio de comunicados por push, e-mail e WhatsApp',
            'Enquetes rápidas',
            'Confirmação de leitura',
            'Biblioteca de documentos (atas, regras, comunicados)',
          ],
        },
      ],
    },
    {
      id: 9,
      title: 'Funcionários e Terceirizados',
      description: 'Escalas, férias, treinamentos, EPIs e ocorrências.',
      groups: [
        {
          title: 'Pessoas',
          items: [
            'Cadastro de funcionários',
            'Controle de escala',
            'Controle de férias',
            'Registro de treinamentos',
            'Entrega de EPIs',
            'Registro de ocorrências com funcionários',
            'Avaliação de desempenho',
          ],
        },
      ],
    },
    {
      id: 10,
      title: 'Contratos e Fornecedores',
      description: 'Vencimentos, reajustes, avaliação e histórico de serviços.',
      groups: [
        {
          title: 'Contratações',
          items: [
            'Cadastro de fornecedores',
            'Upload de contratos',
            'Alertas de vencimento de contrato',
            'Controle de reajustes',
            'Avaliação de fornecedores',
            'Histórico de serviços prestados',
          ],
        },
      ],
    },
    {
      id: 11,
      title: 'Seguros e Riscos',
      description: 'Apólices, renovações, sinistros e riscos mapeados.',
      groups: [
        {
          title: 'Gestão de Riscos',
          items: [
            'Cadastro da apólice de seguro',
            'Alertas de renovação',
            'Registro de sinistros',
            'Upload de laudos',
            'Controle de riscos mapeados',
          ],
        },
      ],
    },
    {
      id: 12,
      title: 'Dashboard Inteligente (IA)',
      description: 'Indicadores e alertas proativos para decisão e economia.',
      groups: [
        {
          title: 'IA e Insights',
          items: [
            'Indicador de saúde financeira do condomínio',
            'Alerta de gastos fora do padrão',
            'Alerta de aumento de inadimplência',
            'Previsão de necessidade de obras futuras',
            'Ranking de maiores custos',
            'Sugestões automáticas de economia',
          ],
        },
      ],
    },
    {
      id: 13,
      title: 'Modo Carteira (Vários Condomínios)',
      description: 'Painel global, padrões replicáveis, compras em escala e auditoria.',
      groups: [
        {
          title: 'Visão Global',
          items: [
            'Painel com TODOS os condomínios',
            'Comparativo financeiro entre eles',
            'Comparativo de inadimplência',
            'Comparativo de custo por unidade',
          ],
        },
        {
          title: 'Padronização',
          items: [
            'Modelos de comunicados',
            'Modelos de assembleia',
            'Modelos de orçamento',
            'Padrões de manutenção',
          ],
        },
        {
          title: 'Compras em Escala',
          items: ['Negociação de contratos coletivos', 'Controle de fornecedores compartilhados'],
        },
        {
          title: 'Auditoria',
          items: [
            'Alertas de condomínio com problema financeiro',
            'Alertas de condomínio com manutenção atrasada',
            'Relatórios consolidados',
          ],
        },
      ],
    },
    {
      id: 14,
      title: 'Documentação Digital',
      description: 'Biblioteca com versões, permissões e busca rápida.',
      groups: [
        {
          title: 'Documentos',
          items: [
            'Armazenamento em nuvem (simulado no site, mas previsto como feature)',
            'Busca por palavra-chave',
            'Controle de versões de documentos',
            'Permissões de acesso por perfil',
          ],
        },
      ],
    },
    {
      id: 15,
      title: 'Controle de Acesso ao Sistema',
      description: 'Perfis e logs de auditoria por usuário.',
      groups: [
        {
          title: 'Perfis e Auditoria',
          items: [
            'Perfis: Síndico, Subsíndico, Conselho, Porteiro, Morador, Gestor de Carteira',
            'Registro de tudo que cada usuário fez (log/auditoria)',
          ],
        },
      ],
    },
    {
      id: 16,
      title: 'App do Morador (Integrado)',
      description: 'Autoatendimento: boletos, reservas, chamados e transparência.',
      groups: [
        {
          title: 'Recursos',
          items: [
            '2ª via de boleto',
            'Abrir chamados',
            'Reservar salão/churrasqueira',
            'Receber comunicados',
            'Votar em enquetes',
            'Acompanhar obras',
            'Ver prestação de contas',
          ],
        },
      ],
    },
    {
      id: 17,
      title: 'Automações',
      description: 'Rotinas automáticas e integrações futuras.',
      groups: [
        {
          title: 'Rotinas',
          items: [
            'Envio automático de boletos',
            'Lembrete automático de assembleia',
            'Lembrete de manutenção vencendo',
            'Lembrete de contrato vencendo',
            'Aviso de barulho fora do horário (integração futura com sensores)',
          ],
        },
      ],
    },
  ];

  const flattenFeatures = (data) => {
    const flat = [];
    for (const module of data) {
      for (const group of module.groups) {
        for (const item of group.items) {
          flat.push({
            moduleId: module.id,
            moduleTitle: module.title,
            groupTitle: group.title,
            text: item,
            norm: normalizeText(item),
          });
        }
      }
    }
    return flat;
  };

  const allFeatures = flattenFeatures(modulesData);
  const totalFeaturesCount = allFeatures.length;

  const moduleIconId = {
    1: 'building',
    2: 'wallet',
    3: 'wrench',
    4: 'shield',
    5: 'layers',
    6: 'users',
    7: 'bell',
    8: 'megaphone',
    9: 'users',
    10: 'doc',
    11: 'shield',
    12: 'brain',
    13: 'chart',
    14: 'doc',
    15: 'lock',
    16: 'phone',
    17: 'bolt',
  };

  function setDefaultThemeIfMissing() {
    try {
      const saved = localStorage.getItem('condoflow-theme');
      if (!saved) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  function initThemeToggle() {
    const btn = qs('#themeToggle');
    if (!btn) return;

    const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

    const sync = () => {
      const pressed = isDark();
      btn.setAttribute('aria-pressed', String(pressed));
    };

    btn.addEventListener('click', () => {
      const next = !isDark();
      if (next) document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');

      try {
        localStorage.setItem('condoflow-theme', next ? 'dark' : 'light');
      } catch (e) {}
      sync();
    });

    sync();
  }

  function initLoader() {
    const loader = qs('#loader');
    const bar = qs('#loaderBar');
    const percentEl = qs('#loaderPercent');
    const textEl = qs('#loaderText');

    if (!loader || !bar || !percentEl) return;

    // Marcador para fallback no HTML saber que o loader foi inicializado.
    window.__cfLoaderInit = true;

    document.body.classList.add('is-loading');

    // Fade-in sutil
    window.requestAnimationFrame(() => {
      loader.classList.add('is-visible');
    });

    const MIN_MS = 2000;
    const MAX_MS = 8000;
    const startTs = performance.now();
    let pageLoaded = document.readyState === 'complete';

    let finished = false;

    let p = 0;
    
    // Frase fixa com efeito de fade via CSS
    if (textEl) {
      textEl.textContent = "Deixando sua gestão mais leve…";
      // Pequeno delay para iniciar o fade-in junto com a barra
      setTimeout(() => {
        textEl.classList.add('is-visible');
      }, 100);
    }
    
    const tick = () => {
      // Sobe rápido no começo e desacelera
      const step = p < 55 ? 6 : p < 80 ? 3 : 1;
      p = Math.min(92, p + step);
      bar.style.width = `${p}%`;
      percentEl.textContent = `${p}%`;
    };

    const timer = window.setInterval(tick, 120);

    const finish = () => {
      if (finished) return;
      finished = true;
      window.__cfLoaderFinished = true;
      window.clearInterval(timer);
      
      // Remove a classe para disparar o fade-out do texto antes do loader fechar (opcional, ou deixa junto)
      // Ajuste: Vamos deixar o fade do loader cuidar disso, ou forçar fade-out do texto no final:
      if (textEl) textEl.classList.remove('is-visible');

      p = 100;
      bar.style.width = '100%';
      percentEl.textContent = '100%';
      // Removed 'Pronto!' change to keep the phrase visible until fade out

      window.setTimeout(() => {
        loader.classList.add('is-hidden');
        document.body.classList.remove('is-loading');

        window.setTimeout(() => {
          loader.setAttribute('hidden', '');
        }, 380);
      }, 260);
    };

    const tryFinish = () => {
      const elapsed = performance.now() - startTs;
      if (pageLoaded && elapsed >= MIN_MS) finish();
    };

    // Garante no mínimo 2s e também aguarda o load real.
    window.setTimeout(tryFinish, MIN_MS);

    // Failsafe: nunca deixa o loader travado indefinidamente.
    window.setTimeout(() => {
      if (!finished) finish();
    }, MAX_MS);

    if (!pageLoaded) {
      window.addEventListener(
        'load',
        () => {
          pageLoaded = true;
          tryFinish();
        },
        { once: true }
      );
    } else {
      tryFinish();
    }
  }

  function initScrollProgress() {
    const bar = qs('#scrollProgressBar');
    if (!bar) return;

    const update = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const height = doc.scrollHeight - doc.clientHeight;
      const pct = height > 0 ? (scrollTop / height) * 100 : 0;
      bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }

  function initBackToTop() {
    const btn = qs('#backTop');
    if (!btn) return;

    const update = () => {
      const show = window.scrollY > 650;
      btn.classList.toggle('is-visible', show);
    };

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  function initNavMenu() {
    const toggle = qs('#navToggle');
    const menu = qs('#navMenu');
    const backdrop = qs('#navBackdrop');
    if (!toggle || !menu || !backdrop) return;

    const open = () => {
      menu.classList.add('is-open');
      backdrop.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('is-menu-open');
    };

    const close = () => {
      menu.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('is-menu-open');
    };

    const isOpen = () => menu.classList.contains('is-open');

    toggle.addEventListener('click', () => {
      if (isOpen()) close();
      else open();
    });

    backdrop.addEventListener('click', close);

    qsa('a.nav__link', menu).forEach((link) => {
      link.addEventListener('click', () => {
        close();
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
  }

  function initIntersectionAnimations() {
    const targets = qsa('[data-animate]');
    if (!targets.length) return;

    // Failsafe: mesmo com JS ativo, nunca deixamos o layout invisível.
    // Se por qualquer motivo o observer não rodar, liberamos tudo.
    window.setTimeout(() => {
      targets.forEach((el) => el.classList.add('in-view'));
    }, 1500);

    // Fallback: em browsers antigos (ou WebViews) sem IntersectionObserver,
    // não podemos deixar o conteúdo invisível.
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in-view'));
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            obs.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 }
    );

    targets.forEach((el) => obs.observe(el));
  }

  function createFeatureItem(text) {
    const li = document.createElement('li');
    li.className = 'featureItem';
    li.dataset.text = normalizeText(text);

    const check = document.createElement('span');
    check.className = 'featureItem__check';
    check.setAttribute('aria-hidden', 'true');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon icon--sm');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', 'assets/icons.svg#check');
    svg.appendChild(use);
    check.appendChild(svg);

    const p = document.createElement('p');
    p.className = 'featureItem__text';
    p.textContent = text;

    li.append(check, p);
    return li;
  }

  function renderModuleCards(container, data) {
    container.innerHTML = '';

    for (const module of data) {
      const total = module.groups.reduce((acc, g) => acc + g.items.length, 0);

      const iconId = moduleIconId[module.id] || 'layers';

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'moduleCard';
      card.dataset.moduleId = String(module.id);
      card.setAttribute('aria-label', `Abrir módulo ${module.id}: ${module.title}`);

      const top = document.createElement('div');
      top.className = 'moduleCard__top';

      const iconWrap = document.createElement('span');
      iconWrap.className = 'moduleCard__icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      iconWrap.innerHTML = `<svg class="icon icon--sm" aria-hidden="true"><use href="assets/icons.svg#${iconId}"></use></svg>`;

      const id = document.createElement('div');
      id.className = 'moduleCard__id';
      id.textContent = `#${module.id.toString().padStart(2, '0')}`;

      const count = document.createElement('div');
      count.className = 'moduleCard__count';
      count.dataset.count = 'total';
      count.textContent = `${total} funções`;

      top.append(iconWrap, id, count);

      const title = document.createElement('h4');
      title.className = 'moduleCard__title';
      title.textContent = module.title;

      const desc = document.createElement('p');
      desc.className = 'moduleCard__desc';
      desc.textContent = module.description;

      card.append(top, title, desc);
      container.append(card);
    }
  }

  function renderModulesAccordion(container, data) {
    container.innerHTML = '';

    for (const module of data) {
      const total = module.groups.reduce((acc, g) => acc + g.items.length, 0);

      const iconId = moduleIconId[module.id] || 'layers';

      const item = document.createElement('div');
      item.className = 'accItem';
      item.dataset.moduleId = String(module.id);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'accItem__btn';
      btn.setAttribute('aria-expanded', 'false');

      const panelId = `acc-panel-${module.id}`;
      btn.setAttribute('aria-controls', panelId);

      const titleWrap = document.createElement('div');
      titleWrap.className = 'accItem__titleWrap';

      const iconWrap = document.createElement('span');
      iconWrap.className = 'accItem__icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      iconWrap.innerHTML = `<svg class="icon icon--sm" aria-hidden="true"><use href="assets/icons.svg#${iconId}"></use></svg>`;

      const title = document.createElement('h4');
      title.className = 'accItem__title';
      title.textContent = `${module.id.toString().padStart(2, '0')}. ${module.title}`;

      const meta = document.createElement('div');
      meta.className = 'accItem__meta';
      meta.dataset.meta = 'count';
      meta.textContent = `${total} funções`;

      titleWrap.append(iconWrap, title, meta);

      const chev = document.createElement('span');
      chev.className = 'accItem__chev';
      chev.setAttribute('aria-hidden', 'true');
      // Embedded SVG to ensure it renders immediately without cache issues
      chev.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;

      btn.append(titleWrap, chev);

      const panel = document.createElement('div');
      panel.className = 'accItem__panel';
      panel.id = panelId;
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', `Conteúdo do módulo ${module.title}`);

      const content = document.createElement('div');
      content.className = 'accItem__content';

      for (const group of module.groups) {
        const groupTitle = document.createElement('p');
        groupTitle.className = 'finePrint';
        groupTitle.style.margin = '14px 0 10px';
        groupTitle.textContent = group.title;

        const list = document.createElement('ul');
        list.className = 'featureList';
        list.dataset.group = normalizeText(group.title);

        for (const feature of group.items) {
          list.append(createFeatureItem(feature));
        }

        content.append(groupTitle, list);
      }

      panel.append(content);
      item.append(btn, panel);
      container.append(item);
    }
  }

  function setPanelOpen(accItem, open) {
    const btn = qs('.accItem__btn', accItem);
    const panel = qs('.accItem__panel', accItem);
    if (!btn || !panel) return;

    const isOpen = accItem.classList.contains('is-open');
    if (open === isOpen) return;

    accItem.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));

    if (open) {
      panel.hidden = false;
      // abre com transição
      panel.style.height = '0px';
      const target = panel.scrollHeight;
      requestAnimationFrame(() => {
        panel.style.height = `${target}px`;
      });
      const onEnd = () => {
        panel.style.height = 'auto';
        panel.removeEventListener('transitionend', onEnd);
      };
      panel.addEventListener('transitionend', onEnd);
    } else {
      const current = panel.scrollHeight;
      panel.style.height = `${current}px`;
      requestAnimationFrame(() => {
        panel.style.height = '0px';
      });
      const onEnd = () => {
        panel.hidden = true;
        panel.style.height = '';
        panel.removeEventListener('transitionend', onEnd);
      };
      panel.addEventListener('transitionend', onEnd);
    }
  }

  function initModulesUI() {
    const cards = qs('#moduleCards');
    const acc = qs('#modulesAccordion');
    const input = qs('#featureSearch');
    const clearBtn = qs('#searchClear');
    const meta = qs('#searchMeta');
    const noResults = qs('#noResults');

    if (!cards || !acc || !input || !clearBtn || !meta || !noResults) return;

    renderModuleCards(cards, modulesData);
    renderModulesAccordion(acc, modulesData);

    // Clique no card => scroll + abre o acordeão correspondente
    cards.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target.closest('.moduleCard') : null;
      if (!target) return;

      const moduleId = target.getAttribute('data-module-id');
      const accItem = moduleId ? qs(`.accItem[data-module-id="${moduleId}"]`, acc) : null;
      if (!accItem) return;

      const y = accItem.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: y, behavior: 'smooth' });
      setPanelOpen(accItem, true);
    });

    // Acordeões acessíveis
    acc.addEventListener('click', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('.accItem__btn') : null;
      if (!btn) return;
      const item = btn.closest('.accItem');
      if (!item) return;
      const open = !(item.classList.contains('is-open'));
      setPanelOpen(item, open);
    });

    // Enter/Espaço
    acc.addEventListener('keydown', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('.accItem__btn') : null;
      if (!btn) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });

    const updateMeta = (query, visibleCount, visibleModules) => {
      if (!query) {
        meta.textContent = 'Digite para filtrar as funções.';
        return;
      }
      meta.textContent = `Encontradas ${visibleCount} funções em ${visibleModules} módulos para “${query}”.`;
    };

    const applyFilter = () => {
      const raw = input.value;
      const query = normalizeText(raw);

      // Atualiza itens
      const accItems = qsa('.accItem', acc);
      let visibleFeatures = 0;
      let visibleModules = 0;

      accItems.forEach((moduleEl) => {
        const featureEls = qsa('.featureItem', moduleEl);
        let moduleMatches = 0;

        featureEls.forEach((el) => {
          const text = el.dataset.text || '';
          const show = !query || text.includes(query);
          el.hidden = !show;
          if (show) moduleMatches += 1;
        });

        // Esconde listas/grupos vazios
        qsa('.featureList', moduleEl).forEach((list) => {
          const any = qsa('.featureItem', list).some((li) => !li.hidden);
          // título do grupo é o elemento anterior (finePrint) criado no render
          const groupTitle = list.previousElementSibling;
          if (groupTitle && groupTitle.classList.contains('finePrint')) {
            groupTitle.hidden = !any;
          }
          list.hidden = !any;
        });

        const showModule = moduleMatches > 0;
        moduleEl.hidden = !showModule;
        if (showModule) {
          visibleModules += 1;
          visibleFeatures += moduleMatches;
        }

        // meta por módulo
        const metaEl = qs('[data-meta="count"]', moduleEl);
        if (metaEl) {
          if (!query) {
            const total = featureEls.length;
            metaEl.textContent = `${total} funções`;
          } else {
            metaEl.textContent = `${moduleMatches} correspondências`;
          }
        }

        // Se módulo aberto ficou sem itens (pode acontecer em transição), fecha
        if (moduleEl.classList.contains('is-open') && !showModule) {
          setPanelOpen(moduleEl, false);
        }
      });

      // Atualiza cards
      qsa('.moduleCard', cards).forEach((card) => {
        const id = card.getAttribute('data-module-id');
        const moduleEl = id ? qs(`.accItem[data-module-id="${id}"]`, acc) : null;
        const show = moduleEl ? !moduleEl.hidden : true;
        card.hidden = !show;

        const countEl = qs('.moduleCard__count', card);
        if (countEl && id) {
          const module = modulesData.find((m) => String(m.id) === String(id));
          const total = module ? module.groups.reduce((a, g) => a + g.items.length, 0) : 0;

          if (!query) {
            countEl.textContent = `${total} funções`;
          } else {
            // conta matches lendo do acordeão (já calculado no meta)
            const metaEl = moduleEl ? qs('[data-meta="count"]', moduleEl) : null;
            const matches = metaEl ? metaEl.textContent.replace(/\D+/g, '') : '';
            const n = matches ? Number(matches) : 0;
            countEl.textContent = `${n} / ${total}`;
          }
        }
      });

      noResults.hidden = visibleFeatures > 0;
      updateMeta(raw.trim(), visibleFeatures, visibleModules);
    };

    input.addEventListener('input', applyFilter);

    clearBtn.addEventListener('click', () => {
      input.value = '';
      input.focus();
      applyFilter();
    });

    // Primeira renderização
    applyFilter();

    // Sanity: se algo estiver faltando, exibe no console
    try {
      const countRendered = qsa('.featureItem', acc).length;
      if (countRendered !== totalFeaturesCount) {
        console.warn('[Viva Haven] Contagem divergente de funcionalidades:', {
          dataset: totalFeaturesCount,
          rendered: countRendered,
        });
      }
    } catch (e) {}
  }

  function initFAQ() {
    const root = qs('#faqAccordion');
    if (!root) return;

    root.addEventListener('click', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('.faqItem__q') : null;
      if (!btn) return;
      const item = btn.closest('.faqItem');
      if (!item) return;
      const ans = qs('.faqItem__a', item);
      if (!ans) return;

      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      ans.hidden = expanded;
    });

    root.addEventListener('keydown', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('.faqItem__q') : null;
      if (!btn) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  }

  function showToast({ title, message }) {
    const wrap = qs('#toastWrap');
    if (!wrap) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');

    const body = document.createElement('div');

    const h = document.createElement('p');
    h.className = 'toast__title';
    h.textContent = title;

    const p = document.createElement('p');
    p.className = 'toast__text';
    p.textContent = message;

    body.append(h, p);

    const close = document.createElement('button');
    close.className = 'toast__close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Fechar notificação');
    close.textContent = 'Fechar';

    close.addEventListener('click', () => {
      toast.classList.remove('is-show');
      window.setTimeout(() => toast.remove(), 200);
    });

    toast.append(body, close);
    wrap.append(toast);

    requestAnimationFrame(() => toast.classList.add('is-show'));

    window.setTimeout(() => {
      if (!toast.isConnected) return;
      toast.classList.remove('is-show');
      window.setTimeout(() => toast.remove(), 200);
    }, 4200);
  }

  function initContactForm() {
    const form = qs('#contactForm');
    if (!form) return;

    const fields = {
      name: qs('#name'),
      email: qs('#email'),
      phone: qs('#phone'),
      profile: qs('#profile'),
      message: qs('#message'),
    };

    const errors = {
      name: qs('#err-name'),
      email: qs('#err-email'),
      phone: qs('#err-phone'),
      profile: qs('#err-profile'),
      message: qs('#err-message'),
    };

    const setError = (key, msg) => {
      const el = fields[key];
      const err = errors[key];
      if (err) err.textContent = msg || '';
      if (el) el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };

    const validate = () => {
      let ok = true;

      const name = (fields.name?.value || '').trim();
      const email = (fields.email?.value || '').trim();
      const phone = (fields.phone?.value || '').trim();
      const profile = (fields.profile?.value || '').trim();
      const message = (fields.message?.value || '').trim();

      setError('name', '');
      setError('email', '');
      setError('phone', '');
      setError('profile', '');
      setError('message', '');

      if (name.length < 2) {
        setError('name', 'Informe seu nome.');
        ok = false;
      }

      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) {
        setError('email', 'Informe um e-mail válido.');
        ok = false;
      }

      const digits = phone.replace(/\D+/g, '');
      if (digits.length < 10) {
        setError('phone', 'Informe um telefone válido.');
        ok = false;
      }

      if (!profile) {
        setError('profile', 'Selecione um perfil.');
        ok = false;
      }

      if (message.length < 10) {
        setError('message', 'Descreva sua necessidade (mín. 10 caracteres).');
        ok = false;
      }

      return ok;
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validate()) {
        showToast({
          title: 'Revise os campos',
          message: 'Alguns dados estão faltando ou inválidos.',
        });
        return;
      }

      // Simula envio
      const submitBtn = qs('button[type="submit"]', form);
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando…';
      }

      window.setTimeout(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar';
        }
        form.reset();
        qsa('[aria-invalid="true"]', form).forEach((el) => el.setAttribute('aria-invalid', 'false'));
        Object.keys(errors).forEach((k) => errors[k].textContent = '');

        showToast({
          title: 'Mensagem enviada (simulação)',
          message: 'Recebemos seu contato. Em um produto real, isso seria enviado ao backend.',
        });
      }, 850);
    });
  }

  function initYear() {
    const y = qs('#year');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  document.addEventListener('DOMContentLoaded', () => {
    setDefaultThemeIfMissing();

    // Só ativa o estado inicial de animação quando o JS carregou de fato.
    // Assim, se o app.js der erro/404, o conteúdo permanece visível.
    try {
      document.documentElement.classList.add('js-animate');
    } catch (e) {}

    initLoader();
    initScrollProgress();
    initBackToTop();
    initNavMenu();
    initIntersectionAnimations();
    initThemeToggle();

    initModulesUI();
    initFAQ();
    initContactForm();
    initYear();
  });
})();
