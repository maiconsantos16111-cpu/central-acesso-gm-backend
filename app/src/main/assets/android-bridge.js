/* ============================================================
   Ponte WebView — Central de Acesso GM (Android)
   Substitui as rotas do servidor Windows por chamadas nativas
   ou por um backend HTTPS configurado em Gestão > Impressora.
   ============================================================ */
(function () {
  "use strict";

  if (!window.GMAndroid) return;

  var cfg = {};
  try {
    cfg = JSON.parse(GMAndroid.getConfig() || "{}") || {};
  } catch (e) {
    cfg = {};
  }
  window.GMAndroidConfig = cfg;

  var sequencia = 0;
  var pendentes = Object.create(null);

  window.__gmAndroidCallback = function (id, transporteOk, json) {
    var pendente = pendentes[id];
    if (!pendente) return;
    delete pendentes[id];

    var dados = {};
    try { dados = JSON.parse(json || "{}") || {}; } catch (e) { dados = {}; }

    if (transporteOk) {
      pendente.resolve(dados);
    } else {
      pendente.reject(new Error(
        dados.erro || dados.error || "Falha de comunicação com o aplicativo Android."
      ));
    }
  };

  function chamar(tipo, dados) {
    return new Promise(function (resolve, reject) {
      var id = "gm" + (++sequencia) + "_" + Date.now();
      pendentes[id] = { resolve: resolve, reject: reject };

      try {
        if (tipo === "request") {
          GMAndroid.requestAsync(
            id,
            dados.url || "",
            dados.method || "GET",
            JSON.stringify(dados.headers || {}),
            dados.body == null ? "" : String(dados.body)
          );
        } else if (tipo === "check") {
          GMAndroid.checkPrinterAsync(id);
        } else if (tipo === "print") {
          GMAndroid.printAsync(id, JSON.stringify(dados));
        } else {
          delete pendentes[id];
          reject(new Error("Recurso Android desconhecido: " + tipo));
        }
      } catch (e) {
        delete pendentes[id];
        reject(e);
      }
    });
  }

  function resposta(dados, status) {
    status = status || 200;
    var ok = status >= 200 && status < 300;
    return {
      ok: ok,
      status: status,
      statusText: ok ? "OK" : "Erro",
      headers: { get: function () { return "application/json"; } },
      json: function () { return Promise.resolve(dados); },
      text: function () { return Promise.resolve(JSON.stringify(dados)); }
    };
  }

  function erro(mensagem, status) {
    return resposta({ ok: false, erro: mensagem }, status || 500);
  }

  function parseCorpo(texto) {
    if (!texto) return null;
    try { return JSON.parse(texto); } catch (e) { return null; }
  }

  function valor(id) {
    var campo = document.getElementById(id);
    return campo ? String(campo.value || "").trim() : "";
  }

  function configuracaoWeb() {
    return {
      modo: "direto",
      impressora: cfg.printerHost || "",
      papelPadrao: cfg.papelPadrao || "personalizado",
      papelNome: cfg.papelNome || "",
      larguraMm: Number(cfg.larguraMm) || 72,
      alturaMm: Number(cfg.alturaMm) || 100
    };
  }

  function aplicarCampos() {
    var pares = {
      "android-printer-host": cfg.printerHost || "",
      "android-printer-port": String(cfg.printerPort || 9100),
      "android-printer-protocol": cfg.printerProtocol || "escpos",
      "android-integration-mode": cfg.integrationMode || "maestro-direto",
      "android-backend-url": cfg.backendUrl || "",
      "android-backend-token": cfg.backendToken || "",
      "android-maestro-base": cfg.maestroBase || "",
      "android-maestro-key": cfg.maestroApiKey || "",
      "android-maestro-origin": cfg.maestroRequestOrigin || "",
      "android-print-timeout": String(cfg.printTimeoutMs || 10000),
      "android-allow-insecure": cfg.allowInsecure ? "true" : "false"
    };

    Object.keys(pares).forEach(function (id) {
      var campo = document.getElementById(id);
      if (campo) campo.value = pares[id];
    });
  }

  function lerCampos() {
    return {
      printerHost: valor("android-printer-host"),
      printerPort: Number(valor("android-printer-port")) || 9100,
      printerProtocol: valor("android-printer-protocol") || "escpos",
      printTimeoutMs: Number(valor("android-print-timeout")) || 10000,
      integrationMode: valor("android-integration-mode") || "maestro-direto",
      backendUrl: valor("android-backend-url"),
      backendToken: valor("android-backend-token"),
      maestroBase: valor("android-maestro-base"),
      maestroApiKey: valor("android-maestro-key"),
      maestroRequestOrigin: valor("android-maestro-origin"),
      allowInsecure: valor("android-allow-insecure") === "true",
      papelPadrao: cfg.papelPadrao || "personalizado",
      papelNome: cfg.papelNome || "",
      larguraMm: Number(cfg.larguraMm) || 72,
      alturaMm: Number(cfg.alturaMm) || 100
    };
  }

  function salvarCampos(cfgWeb) {
    var atual = lerCampos();
    atual.papelPadrao = cfgWeb.papelPadrao || atual.papelPadrao;
    atual.papelNome = cfgWeb.papelNome || "";
    atual.larguraMm = Number(cfgWeb.larguraMm) || atual.larguraMm;
    atual.alturaMm = Number(cfgWeb.alturaMm) || atual.alturaMm;

    var salvo = {};
    try {
      salvo = JSON.parse(GMAndroid.saveConfig(JSON.stringify(atual)) || "{}") || {};
    } catch (e) {
      return erro("Não foi possível salvar a configuração no aplicativo: " + e.message);
    }

    if (!salvo.ok) {
      return erro(salvo.erro || "Configuração inválida.");
    }

    cfg = salvo.config || cfg;
    window.GMAndroidConfig = cfg;
    aplicarCampos();
    return resposta({ ok: true, config: configuracaoWeb() });
  }

  /* ---------------- modo de teste (sem envio ao Maestro) ---------------- */

  var demonstracao = { id: "", cpf: "" };

  function hashSimples(texto) {
    var h = 0;
    for (var i = 0; i < texto.length; i++) {
      h = ((h << 5) - h + texto.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  }

  function gmIdDemonstracao(cpf) {
    return "gm" + hashSimples(cpf || "00000000000") + "br";
  }

  function responderDemonstracao(caminho, corpo) {
    corpo = corpo || {};

    if (caminho === "maestro/questionario") {
      demonstracao.cpf = String(corpo.cpf || "").replace(/\D/g, "");
      demonstracao.id = "DEMO-" + Date.now().toString(36).toUpperCase();
      return resposta({
        ok: true,
        fluxo: corpo.fluxo || "id",
        id: demonstracao.id,
        tipo: corpo.tipo || "CLT",
        questoes: [
          {
            id: 0,
            questao: "Data de nascimento",
            tipo: "ENTRADA_MANUAL",
            tipoEntrada: "DATA",
            placeholder: "DD/MM/AAAA",
            alternativas: []
          },
          {
            id: 1,
            questao: "Nome da mãe",
            tipo: "ENTRADA_MANUAL",
            tipoEntrada: "TEXTO",
            placeholder: "Como consta no cadastro",
            alternativas: []
          }
        ]
      });
    }

    if (caminho === "maestro/responder") {
      if (corpo.fluxo === "senha") {
        return resposta({ ok: true, id: corpo.id || demonstracao.id, criterios: [] });
      }
      return resposta({
        ok: true,
        gmId: gmIdDemonstracao(demonstracao.cpf),
        titulo: "GM ID localizado",
        mensagem: "Consulta demonstrativa, sem envio ao Maestro."
      });
    }

    if (caminho === "maestro/senha") {
      return resposta({ ok: true, confirmado: true });
    }

    return erro("Rota de demonstração não conhecida: " + caminho, 404);
  }

  /* ---------- modo Maestro direto (sai pela internet do tablet) ---------- */

  function validarTipoDireto(valor) {
    var textoValor = String(valor || "");
    if (!/^[A-Za-z0-9_]{1,40}$/.test(textoValor)) {
      throw new Error("Vínculo inválido.");
    }
    return textoValor;
  }

  function validarIdDireto(valor) {
    var textoValor = String(valor || "");
    if (!/^[A-Za-z0-9\-]{8,64}$/.test(textoValor)) {
      throw new Error("Identificador do questionário inválido.");
    }
    return textoValor;
  }

  function validarRespostasDireto(lista) {
    if (!Array.isArray(lista) || lista.length < 1 || lista.length > 10) {
      throw new Error("Respostas inválidas.");
    }
    return lista.map(function (item) {
      var numero = Number(item && item.id);
      if (Math.floor(numero) !== numero || numero < 0 || numero > 999) {
        throw new Error("Pergunta inválida.");
      }
      var resposta = String((item && item.resposta) == null ? "" : item.resposta);
      if (!resposta.trim() || resposta.length > 120 || /[\x00-\x1F\x7F]/.test(resposta)) {
        throw new Error("Resposta inválida.");
      }
      return { id: numero, resposta: resposta };
    });
  }

  function detalheMaestro(dados, status) {
    var mensagem = "";
    if (dados && typeof dados === "object") {
      mensagem = String(dados.message || dados.mensagem || "");
    }
    if (!mensagem.trim()) {
      mensagem = "O Maestro recusou a operação (HTTP " + status + ").";
    }
    return mensagem.replace(/^\[SM\]\s*/, "");
  }

  function maestroDireto(caminho, corpo) {
    corpo = corpo || {};
    var base = String(cfg.maestroBase || "").trim().replace(/\/+$/, "");
    if (!base) {
      return Promise.resolve(erro(
        "URL base do Maestro não configurada. Abra Gestão → Impressora.", 400
      ));
    }

    var metodo = "POST";
    var rota = "";
    var enviar = null;
    var fluxo = String(corpo.fluxo) === "senha" ? "senha" : "id";
    var tipo = "";
    var id = "";

    try {
      if (caminho === "maestro/questionario") {
        var cpf = String(corpo.cpf || "").replace(/\D/g, "");
        if (!/^\d{11}$/.test(cpf)) throw new Error("CPF inválido.");
        tipo = validarTipoDireto(corpo.tipo);
        rota = fluxo === "senha"
          ? "/v1/senha/reset/questionario"
          : "/v1/identidade-digital/questionario/recuperar";
        enviar = { cpf: cpf, tipo: tipo };
      } else if (caminho === "maestro/responder") {
        id = validarIdDireto(corpo.id);
        tipo = validarTipoDireto(corpo.tipo);
        var respostas = validarRespostasDireto(corpo.respostas);
        rota = fluxo === "senha"
          ? "/v1/senha/reset/respostas"
          : "/v1/identidade-digital/questionario/responder";
        enviar = { id: id, tipo: tipo, respostas: respostas };
      } else if (caminho === "maestro/senha") {
        id = validarIdDireto(corpo.id);
        var senha = String(corpo.senha || "");
        if (senha.length < 6 || senha.length > 64 || /[\x00-\x1F\x7F]/.test(senha)) {
          throw new Error("Senha inválida.");
        }
        metodo = "PUT";
        rota = "/v1/senha/reset/senha";
        enviar = { id: id, senha: senha };
      } else {
        throw new Error("Rota Maestro desconhecida: " + caminho);
      }
    } catch (e) {
      return Promise.resolve(erro(e.message || "Dados inválidos.", 400));
    }

    var cabecalhos = {
      "Content-Type": "application/json; charset=utf-8",
      "Accept": "*/*",
      "x-api-key": String(cfg.maestroApiKey || ""),
      "x-request-origin": String(cfg.maestroRequestOrigin || "")
    };

    return chamar("request", {
      url: base + rota,
      method: metodo,
      headers: cabecalhos,
      body: JSON.stringify(enviar)
    }).then(function (r) {
      var dados = parseCorpo(r.body);
      var status = Number(r.status) || 200;

      if (!r.ok || !dados) {
        return erro(detalheMaestro(dados, status), status >= 400 ? status : 500);
      }

      var traduzido;
      try {
        if (caminho === "maestro/questionario") {
          if (!dados.id) throw new Error("O Maestro não devolveu um questionário válido.");
          traduzido = {
            ok: true,
            fluxo: fluxo,
            id: String(dados.id),
            tipo: String(dados.tipo || tipo),
            questoes: Array.isArray(dados.questoes) ? dados.questoes : []
          };
        } else if (caminho === "maestro/responder") {
          if (fluxo === "senha") {
            traduzido = {
              ok: true,
              id: String(dados.id || id),
              criterios: Array.isArray(dados.criteriosCriacaoSenha)
                ? dados.criteriosCriacaoSenha : []
            };
          } else {
            var gm = String(dados.identidade || "");
            if (!/^[A-Za-z0-9._-]{1,40}$/.test(gm)) {
              throw new Error("O Maestro não devolveu um GM ID válido.");
            }
            traduzido = {
              ok: true,
              gmId: gm,
              titulo: String(dados.titulo || ""),
              mensagem: String(dados.mensagem || "")
            };
          }
        } else {
          traduzido = { ok: true, confirmado: true };
        }
      } catch (e) {
        return erro(e.message || "Resposta inválida do Maestro.", 500);
      }

      return resposta(traduzido, status);
    }).catch(function (e) {
      return erro(e.message || "Não foi possível falar com o Maestro.", 500);
    });
  }

  /* ---------------- fetch compatível com o front-end ---------------- */

  var fetchOriginal = window.fetch ? window.fetch.bind(window) : null;
  if (fetchOriginal) window.__gmFetchOriginal = fetchOriginal;

  function normalizarCaminho(url) {
    var caminho = String(url || "");
    var marcador = "/assets/";
    var indice = caminho.indexOf(marcador);
    if (indice >= 0) caminho = caminho.slice(indice + marcador.length);
    return caminho.split("?")[0].replace(/^\/+/, "");
  }

  window.fetch = function (input, init) {
    init = init || {};

    if (init.signal && init.signal.aborted) {
      return Promise.reject(new DOMException("Operação cancelada", "AbortError"));
    }

    var url = typeof input === "string" ? input : (input && input.url) || "";
    var metodo = String(init.method || (input && input.method) || "GET").toUpperCase();
    var corpo = init.body == null ? "" : String(init.body);
    var caminho = normalizarCaminho(url);

    /* Configuração da impressora e da integração. */
    if (caminho === "config-impressao" && metodo === "GET") {
      aplicarCampos();
      return Promise.resolve(resposta({ ok: true, config: configuracaoWeb() }));
    }

    if (caminho === "config-impressao" && metodo === "POST") {
      return salvarCampos(parseCorpo(corpo) || {});
    }

    if (caminho === "impressoras" && metodo === "GET") {
      var hostImpressora = cfg.printerHost || "";
      return Promise.resolve(resposta({
        ok: true,
        padrao: hostImpressora || "IP da impressora não configurado",
        impressoras: hostImpressora ? [hostImpressora] : []
      }));
    }

    if (caminho.indexOf("papeis") === 0 && metodo === "GET") {
      return Promise.resolve(resposta({ ok: true, impressora: cfg.printerHost || "", papeis: [] }));
    }

    if ((caminho === "imprimir" || caminho === "imprimir/teste") && metodo === "POST") {
      var pedido = parseCorpo(corpo) || {};
      var basico = configuracaoWeb();
      var marca = (window.GM_APP && GM_APP.sistema && GM_APP.sistema.marca) || {};
      var impressao = {
        host: basico.impressora || "",
        port: Number(cfg.printerPort) || 9100,
        protocol: cfg.printerProtocol || "escpos",
        timeoutMs: Number(cfg.printTimeoutMs) || 10000,
        gmId: String(pedido.gmId || (caminho === "imprimir/teste" ? "TESTE" : "") || ""),
        senha: String(pedido.senha || ""),
        papel: pedido.papel || basico.papelPadrao,
        papelNome: pedido.papelNome || basico.papelNome || "",
        larguraMm: Number(pedido.larguraMm) || basico.larguraMm,
        alturaMm: Number(pedido.alturaMm) || basico.alturaMm,
        simulado: pedido.simulado === true,
        marca: marca
      };

      return chamar("print", impressao).then(function (r) {
        if (!r.ok) return erro(r.erro || "Falha ao enviar para a impressora.");
        return resposta({
          ok: true,
          impressora: r.impressora || impressao.host,
          estado: r.estado || "Enviado",
          saudavel: r.saudavel !== false,
          simulado: false
        });
      }).catch(function (e) {
        return erro(e.message || "Falha ao enviar para a impressora.");
      });
    }

    if (caminho.indexOf("maestro/") === 0 && metodo === "POST") {
      var modoIntegracao = cfg.integrationMode || "maestro-direto";
      if (modoIntegracao === "demo") {
        return Promise.resolve(responderDemonstracao(caminho, parseCorpo(corpo)));
      }
      if (modoIntegracao === "maestro-direto") {
        return maestroDireto(caminho, parseCorpo(corpo));
      }

      var cabecalhos = init.headers || {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };

      return chamar("request", {
        url: caminho,
        method: "POST",
        headers: cabecalhos,
        body: corpo
      }).then(function (r) {
        var dados = parseCorpo(r.body);
        var status = Number(r.status) || 200;

        if (!r.ok || !dados) {
          var detalhe = (dados && (dados.erro || dados.message)) ||
            r.erro || "O backend do Maestro não respondeu corretamente.";
          return erro(detalhe, status >= 400 ? status : 500);
        }

        return resposta(dados, status);
      }).catch(function (e) {
        return erro(e.message || "Não foi possível falar com o backend do Maestro.");
      });
    }

    if (fetchOriginal && /^https?:\/\//i.test(url)) {
      return fetchOriginal(input, init);
    }

    return Promise.resolve(erro("Rota não disponível no aplicativo Android: " + caminho, 404));
  };

  function iniciar() {
    aplicarCampos();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
