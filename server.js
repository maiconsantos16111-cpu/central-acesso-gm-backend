/**
 * Backend Maestro para a Central de Acesso GM — Node puro (zero dependencias)
 *
 * Variaveis de ambiente (definidas no painel do Render):
 *   MAESTRO_BASE
 *   MAESTRO_API_KEY
 *   MAESTRO_REQUEST_ORIGIN
 *   BACKEND_TOKEN   (opcional, mas recomendado)
 *   PORT            (o Render define automaticamente)
 *
 * Rotas:
 *   POST /maestro/questionario
 *   POST /maestro/responder
 *   POST /maestro/senha
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 3000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function json(res, body, status = 200) {
  const texto = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS
  });
  res.end(texto);
}

function erro(res, mensagem, status = 400) {
  json(res, { ok: false, erro: mensagem }, status);
}

function autorizado(req) {
  const esperado = String(process.env.BACKEND_TOKEN || '').trim();
  if (!esperado) return true;
  const cabecalho = String(req.headers.authorization || '');
  const recebido = cabecalho.replace(/^Bearer\s+/i, '').trim();
  return recebido === esperado;
}

async function chamarMaestro(metodo, caminho, corpo) {
  const base = String(process.env.MAESTRO_BASE || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('Integracao com o Maestro nao configurada (MAESTRO_BASE).');
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 40000);

  try {
    const resposta = await fetch(base + caminho, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': '*/*',
        'x-api-key': String(process.env.MAESTRO_API_KEY || ''),
        'x-request-origin': String(process.env.MAESTRO_REQUEST_ORIGIN || '')
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: controlador.signal
    });

    const texto = await resposta.text();
    let dados = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch (_) {
      dados = null;
    }
    return { status: resposta.status, dados, texto };
  } finally {
    clearTimeout(temporizador);
  }
}

function ok(r) {
  return r.status >= 200 && r.status < 300;
}

function mensagemMaestro(r) {
  let msg = '';
  if (r.dados) {
    msg = String(r.dados.message ?? r.dados.mensagem ?? '');
  }
  if (!msg.trim()) {
    msg = 'O Maestro recusou a operacao (HTTP ' + r.status + ').';
  }
  return msg.replace(/^\[SM\]\s*/, '');
}

function fluxoDo(corpo) {
  return String(corpo && corpo.fluxo) === 'senha' ? 'senha' : 'id';
}

function validarId(valor) {
  if (!/^[A-Za-z0-9\-]{8,64}$/.test(String(valor || ''))) {
    throw new Error('Identificador do questionario invalido.');
  }
  return String(valor);
}

function validarTipo(valor) {
  if (!/^[A-Za-z0-9_]{1,40}$/.test(String(valor || ''))) {
    throw new Error('Vinculo invalido.');
  }
  return String(valor);
}

function validarRespostas(lista) {
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > 10) {
    throw new Error('Respostas invalidas.');
  }
  return lista.map(function (item) {
    const id = Number(item && item.id);
    if (!Number.isInteger(id) || id < 0 || id > 999) {
      throw new Error('Pergunta invalida.');
    }
    const resposta = String((item && item.resposta) ?? '');
    if (!resposta.trim() || resposta.length > 120 || /[\x00-\x1F\x7F]/.test(resposta)) {
      throw new Error('Resposta invalida.');
    }
    return { id: id, resposta: resposta };
  });
}

async function questionario(corpo) {
  const cpf = String(corpo.cpf ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf)) {
    throw new Error('CPF invalido.');
  }
  const tipo = validarTipo(corpo.tipo);
  const fluxo = fluxoDo(corpo);

  const caminho = fluxo === 'senha'
    ? '/v1/senha/reset/questionario'
    : '/v1/identidade-digital/questionario/recuperar';

  const r = await chamarMaestro('POST', caminho, { cpf: cpf, tipo: tipo });
  if (!ok(r)) {
    throw new Error(mensagemMaestro(r));
  }
  if (!r.dados || !String(r.dados.id || '').trim()) {
    throw new Error('O Maestro nao devolveu um questionario valido.');
  }

  return {
    ok: true,
    fluxo: fluxo,
    id: String(r.dados.id),
    tipo: String(r.dados.tipo ?? tipo),
    questoes: Array.isArray(r.dados.questoes) ? r.dados.questoes : []
  };
}

async function responder(corpo) {
  const id = validarId(corpo.id);
  const tipo = validarTipo(corpo.tipo);
  const fluxo = fluxoDo(corpo);
  const respostas = validarRespostas(corpo.respostas);

  const caminho = fluxo === 'senha'
    ? '/v1/senha/reset/respostas'
    : '/v1/identidade-digital/questionario/responder';

  const r = await chamarMaestro('POST', caminho, {
    id: id,
    tipo: tipo,
    respostas: respostas
  });
  if (!ok(r)) {
    throw new Error(mensagemMaestro(r));
  }

  if (fluxo === 'senha') {
    return {
      ok: true,
      id: String(r.dados?.id ?? id),
      criterios: Array.isArray(r.dados?.criteriosCriacaoSenha)
        ? r.dados.criteriosCriacaoSenha
        : []
    };
  }

  const gm = String(r.dados?.identidade ?? '');
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(gm)) {
    throw new Error('O Maestro nao devolveu um GM ID valido.');
  }

  return {
    ok: true,
    gmId: gm,
    titulo: String(r.dados?.titulo ?? ''),
    mensagem: String(r.dados?.mensagem ?? '')
  };
}

async function senha(corpo) {
  const id = validarId(corpo.id);
  const senha = String(corpo.senha ?? '');
  if (senha.length < 6 || senha.length > 64 || /[\x00-\x1F\x7F]/.test(senha)) {
    throw new Error('Senha invalida.');
  }

  const r = await chamarMaestro('PUT', '/v1/senha/reset/senha', {
    id: id,
    senha: senha
  });
  if (!ok(r)) {
    throw new Error(mensagemMaestro(r));
  }

  return { ok: true, confirmado: true };
}

const rotas = {
  questionario,
  responder,
  senha
};

function lerCorpo(req) {
  return new Promise(function (resolve, reject) {
    let dados = '';
    req.on('data', function (pedaco) {
      dados += pedaco;
      if (dados.length > 1024 * 1024) {
        reject(new Error('Corpo muito grande.'));
        req.destroy();
      }
    });
    req.on('end', function () { resolve(dados); });
    req.on('error', reject);
  });
}

const servidor = http.createServer(async function (req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (!autorizado(req)) {
    erro(res, 'Token de acesso invalido.', 401);
    return;
  }

  if (req.method !== 'POST') {
    erro(res, 'Metodo nao permitido.', 405);
    return;
  }

  let caminho;
  try {
    caminho = new URL(req.url, 'http://localhost').pathname;
  } catch (_) {
    erro(res, 'Rota nao encontrada.', 404);
    return;
  }

  let rota = '';
  if (caminho.endsWith('/maestro/questionario')) rota = 'questionario';
  else if (caminho.endsWith('/maestro/responder')) rota = 'responder';
  else if (caminho.endsWith('/maestro/senha')) rota = 'senha';
  else {
    erro(res, 'Rota nao encontrada.', 404);
    return;
  }

  let texto;
  try {
    texto = await lerCorpo(req);
  } catch (e) {
    erro(res, e.message || 'Falha ao ler o corpo.', 400);
    return;
  }

  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch (_) {
    erro(res, 'JSON invalido.', 400);
    return;
  }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    erro(res, 'JSON invalido.', 400);
    return;
  }

  try {
    json(res, await rotas[rota](corpo));
  } catch (e) {
    erro(res, e && e.message ? e.message : 'Falha ao processar a solicitacao.', 400);
  }
});

servidor.listen(PORT, '0.0.0.0', function () {
  console.log('Backend Maestro ouvindo na porta ' + PORT);
});
