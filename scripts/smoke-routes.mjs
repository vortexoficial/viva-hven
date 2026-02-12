const BASE_URL = 'https://vivahaven-2906a.web.app';

const tests = [
  { route: '/', key: 'O jeito mais claro' },
  { route: '/login.html', key: 'Login' },
  { route: '/register.html', key: 'Criar conta' },
  { route: '/perfil.html', key: 'Perfil' },
  { route: '/app/home.html', key: 'Home' },
  { route: '/app/avisos.html', key: 'Avisos' },
  { route: '/app/boletos.html', key: 'Boletos' },
  { route: '/app/chamados.html', key: 'Chamados' },
  { route: '/app/reservas.html', key: 'Reservas' },
  { route: '/app/reformas.html', key: 'Reformas' },
  { route: '/app/assembleias.html', key: 'Assembleias' },
  { route: '/app/minhas-multas.html', key: 'Multas' },
  { route: '/admin/dashboard.html', key: 'Dashboard' },
  { route: '/admin/condominio.html', key: 'Condomínio' },
  { route: '/admin/pessoas.html', key: 'Pessoas' },
  { route: '/admin/financeiro.html', key: 'Financeiro' },
  { route: '/admin/manutencao.html', key: 'Manutenção' },
  { route: '/admin/obras.html', key: 'Obras' },
  { route: '/admin/seguranca.html', key: 'Segurança' },
  { route: '/admin/logs.html', key: 'Logs' },
];

function normalize(text) {
  return String(text || '').toLowerCase();
}

async function checkRoute(test) {
  const url = `${BASE_URL}${test.route}`;

  try {
    const res = await fetch(url, { method: 'GET' });
    const body = await res.text();

    const hasKey = normalize(body).includes(normalize(test.key));
    const ok = res.status === 200 && hasKey;

    return {
      route: test.route,
      status: res.status,
      key: test.key,
      keyFound: hasKey,
      result: ok ? 'APROVADO' : 'PENDENTE',
    };
  } catch (err) {
    return {
      route: test.route,
      status: 0,
      key: test.key,
      keyFound: false,
      result: 'PENDENTE',
      error: err?.message || String(err),
    };
  }
}

function printTable(results) {
  const headers = ['Rota', 'HTTP', 'Chave', 'Encontrou', 'Resultado'];
  const rows = results.map((r) => [
    r.route,
    String(r.status),
    r.key,
    r.keyFound ? 'SIM' : 'NÃO',
    r.result,
  ]);

  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((row) => String(row[i]).length)));

  const fmt = (row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join(' | ');

  console.log(fmt(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  rows.forEach((r) => console.log(fmt(r)));
}

async function main() {
  const results = [];
  for (const test of tests) {
    results.push(await checkRoute(test));
  }

  const approved = results.filter((r) => r.result === 'APROVADO').length;
  const pending = results.length - approved;

  printTable(results);
  console.log(`\nResumo: ${approved}/${results.length} aprovadas, ${pending} pendentes.`);

  if (pending > 0) {
    process.exitCode = 2;
  }
}

await main();
