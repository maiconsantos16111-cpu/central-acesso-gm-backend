/* ============================================================
   Central de Acesso GM — fluxo do atendimento
   ============================================================ */
(function () {
  "use strict";

  var CFG = window.GM_APP || {};

  var OPCOES = {
    "senha-aleatoria": {
      indice: "Opção 1",
      nome: "Gerar senha aleatória",
      titulo: "Gerar senha aleatória",
      desc: "O sistema recupera o GM ID, cria uma senha forte dentro dos critérios do Maestro e aplica a redefinição.",
      icone: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="3.4"/></svg>',
      reseta: true,
      geraSenha: true,
      passos: [
        "Validar os dados informados",
        "Localizar o cadastro no Maestro",
        "Recuperar o GM ID",
        "Gerar uma senha dentro dos critérios",
        "Aplicar a nova senha",
        "Confirmar a redefinição"
      ],
      nota: "A senha é criada no momento da execução e apagada da memória após a impressão."
    },
    "lembrar-gm": {
      indice: "Opção 2",
      nome: "Lembrar GM ID",
      titulo: "Lembrar GM ID",
      desc: "Consulta o login do colaborador no Maestro. Esta opção não altera a senha em nenhuma hipótese.",
      icone: '<svg viewBox="0 0 24 24" focusable="false"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/><path d="M11 8v3l2 1.5"/></svg>',
      reseta: false,
      geraSenha: false,
      passos: [
        "Validar os dados informados",
        "Localizar o cadastro no Maestro",
        "Recuperar o GM ID",
        "Confirmar a consulta"
      ],
      nota: "O comprovante desta opção contém somente o GM ID, sem senha ou informações adicionais."
    },
    "escolher-senha": {
      indice: "Opção 3",
      nome: "Escolher minha senha",
      titulo: "Escolher minha senha",
      desc: "O colaborador define a nova senha, o sistema valida os critérios e aplica a redefinição no Maestro.",
      icone: '<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="10" width="16" height="10" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14v2.5"/></svg>',
      reseta: true,
      geraSenha: false,
      passos: [
        "Validar os dados e a senha",
        "Localizar o cadastro no Maestro",
        "Recuperar o GM ID",
        "Aplicar a senha escolhida",
        "Confirmar a redefinição"
      ],
      nota: "A senha é validada antes do envio e nunca é gravada em histórico."
    }
  };

  var state = {
    view: "home",
    colaborador: null,
    opcao: null,
    passos: [],
    gmId: "",
    senhaBox: null,
    senhaTamanho: 0,
    protocolo: "",
    simulado: false,
    running: false,
    questoes: [],
    questionarioId: "",
    camposAtivos: [],
    elPass: null,
    elPass2: null,
    tentativas: Object.create(null),
    log: [],
    descansoTimer: null,
    descansoVisivel: false,
    descansoAposImpressao: false,
    descansoAviso: "",
    lastFocus: null,
    adminFocus: null,
    adminPassFocus: null
  };

  var el = {};

  function modoMaestro() {
    return !!(window.GMAdapter && GMAdapter.modo === "maestro");
  }

  /* Etapas reais quando o atendimento passa pela API oficial do Maestro. */
  function passosMaestro(op) {
    if (!op.reseta) {
      return [
        "Validar os dados informados",
        "Consultar o Maestro",
        "Confirmar as respostas de segurança",
        "Recuperar o GM ID"
      ];
    }
    return [
      "Validar os dados e a senha",
      "Consultar o Maestro",
      "Confirmar as respostas de segurança",
      "Recuperar o GM ID",
      "Aplicar a nova senha",
      "Confirmar a redefinição"
    ];
  }

  function notaDoFluxo(op) {
    if (modoMaestro()) {
      return op.reseta
        ? "O Maestro pedirá as perguntas de segurança. A senha só é alterada depois que ele confirma as respostas."
        : "O Maestro pedirá as perguntas de segurança. Esta opção não altera a senha em nenhuma hipótese.";
    }
    return op.nota || "";
  }

  /* ---------------- utilidades ---------------- */

  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }

  function setText(node, texto) { if (node) node.textContent = texto == null ? "" : texto; }

  function onlyDigits(v) { return String(v || "").replace(/\D+/g, ""); }

  function maskCpf(v) {
    var d = onlyDigits(v).slice(0, 11);
    if (d.length > 9) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
    if (d.length > 6) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
    if (d.length > 3) return d.slice(0, 3) + "." + d.slice(3);
    return d;
  }

  function mascararCpf(cpf) { return "***.***.***-" + onlyDigits(cpf).slice(-2); }

  function cpfValido(cpf) {
    if (!/^\d{11}$/.test(cpf)) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    var i, soma = 0;
    for (i = 0; i < 9; i++) soma += Number(cpf.charAt(i)) * (10 - i);
    var d1 = (soma * 10) % 11;
    if (d1 === 10) d1 = 0;
    if (d1 !== Number(cpf.charAt(9))) return false;
    soma = 0;
    for (i = 0; i < 10; i++) soma += Number(cpf.charAt(i)) * (11 - i);
    var d2 = (soma * 10) % 11;
    if (d2 === 10) d2 = 0;
    return d2 === Number(cpf.charAt(10));
  }

  function showError(node, msg) {
    if (!node) return;
    node.textContent = msg;
    node.hidden = false;
  }

  function clearError(node) {
    if (!node) return;
    node.textContent = "";
    node.hidden = true;
  }

  var toastTimer = null;
  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove("show"); }, 4200);
  }

  function copiar(texto, mensagem) {
    function fallback() {
      var area = document.createElement("textarea");
      area.value = texto;
      area.setAttribute("readonly", "readonly");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); } catch (e) { /* ignora */ }
      document.body.removeChild(area);
      toast(mensagem);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () { toast(mensagem); }, fallback);
    } else {
      fallback();
    }
  }

  /* ---------------- política de senha ---------------- */

  var POOL = {
    lower: "abcdefghijkmnopqrstuvwxyz",
    upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
    number: "23456789",
    special: "!@#$%&*?-"
  };

  function regrasSenha(senha) {
    var p = CFG.senha || {};
    var min = Number(p.min) || 8;
    var max = Number(p.max) || 20;
    var regras = [
      { ok: senha.length >= min && senha.length <= max, texto: "De " + min + " a " + max + " caracteres" }
    ];
    if (p.exigirMaiuscula) regras.push({ ok: /[A-Z]/.test(senha), texto: "Pelo menos uma letra maiúscula" });
    if (p.exigirMinuscula) regras.push({ ok: /[a-z]/.test(senha), texto: "Pelo menos uma letra minúscula" });
    if (p.exigirNumero) regras.push({ ok: /[0-9]/.test(senha), texto: "Pelo menos um número" });
    if (p.exigirEspecial) regras.push({ ok: /[^A-Za-z0-9]/.test(senha), texto: "Pelo menos um caractere especial" });
    if (!p.permitirEspacos) regras.push({ ok: senha.length > 0 && !/\s/.test(senha), texto: "Sem espaços" });
    return regras;
  }

  function aleatorioInteiro(max) {
    var limite = Math.floor(4294967296 / max) * max;
    var buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limite);
    return buf[0] % max;
  }

  function sortear(str) { return str.charAt(aleatorioInteiro(str.length)); }

  function embaralhar(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = aleatorioInteiro(i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function gerarSenha() {
    var p = CFG.senha || {};
    var maximo = Number(p.max) || 20;
    var min = Number(p.min) || 12;
    var tamanho = Math.min(maximo, Math.max(min, 12));

    // 1ª letra sempre maiúscula
    // Último caractere: especial
    // Penúltimo caractere: dígito
    // Resto: minúsculo
    var senha = [];

    // Posição 0: maiúscula
    senha[0] = sortear(POOL.upper);

    // Posições 1 a (tamanho-3): minúsculas
    for (var i = 1; i <= tamanho - 3; i++) {
      senha[i] = sortear(POOL.lower);
    }

    // Penúltima posição: dígito
    senha[tamanho - 2] = sortear(POOL.number);

    // Última posição: caractere especial
    senha[tamanho - 1] = sortear(POOL.special);

    return senha.join("");
  }

  function gerarSenhaValida() {
    for (var i = 0; i < 8; i++) {
      var s = gerarSenha();
      if (regrasSenha(s).every(function (r) { return r.ok; })) return s;
    }
    return gerarSenha();
  }

  /* ---------------- configuração / arranque ---------------- */

  function cacheEls() {
    [
      "sim-banner", "mode-chip", "log-count", "home-title",
      "options-hint", "options", "view-home", "view-service", "service-icon", "service-eyebrow",
      "service-title", "service-desc", "service-form", "service-fields", "service-error",
      "btn-run", "btn-run-label", "service-note", "service-progress", "progress-label", "service-result",
      "result-title", "result-sub", "result-gm", "result-pass-row", "result-pass",
      "btn-reveal-pass", "reveal-label", "result-protocol", "result-note",
      "btn-print", "timeline", "service-callout", "toast", "drawer", "drawer-backdrop",
      "admin-drawer", "admin-backdrop", "admin-password-status",
      "admin-pass-drawer", "admin-pass-backdrop", "admin-pass-title", "admin-pass-sub",
      "admin-pass-error", "admin-pass-current-field", "admin-pass-current",
      "admin-pass-new", "admin-pass-new-label", "admin-pass-confirm-field",
      "admin-pass-confirm", "admin-pass-hint", "btn-admin-pass",
      "log-list", "log-empty", "print-root", "print-gm", "print-pass", "print-pass-line",
      "settings", "settings-backdrop", "settings-status", "settings-status-text",
      "settings-mode", "settings-mode-hint", "settings-printer", "settings-paper",
      "settings-paper-custom", "settings-paper-w", "settings-paper-h",
      "settings-paper-hint",
      "settings-note", "settings-error", "btn-test-print", "btn-save-settings",
      "screensaver", "ss-wake", "footer-mode"
    ].forEach(function (id) { el[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id); });
  }

  /* ---------------- papel / etiqueta ---------------- */

  var PAPEIS = ["personalizado", "80mm", "58mm", "a6"];

  /* Medidas fixas de cada opção (mesmas usadas pelo servidor local). */
  var MEDIDAS_PAPEIS = {
    "80mm": { larguraMm: 72, alturaMm: 297 },
    "58mm": { larguraMm: 58, alturaMm: 110 },
    "a6": { larguraMm: 105, alturaMm: 148 }
  };

  /* Última medida livre digitada na janela Impressora. */
  var papelLivreConfig = { larguraMm: 72, alturaMm: 100 };
  var ultimaOpcaoPapelConfig = null;

  function ehPapelDriver(papel) {
    return typeof papel === "string" && papel.indexOf("driver:") === 0;
  }

  function nomePapelDriver(papel) {
    return ehPapelDriver(papel) ? papel.slice(7) : "";
  }

  function papelValido(papel) {
    return PAPEIS.indexOf(papel) >= 0 || ehPapelDriver(papel);
  }

  function medidaMm(valor, minimo, maximo) {
    var n = Number(String(valor == null ? "" : valor).replace(",", ".").trim());
    if (!isFinite(n) || n < minimo || n > maximo) return null;
    return Math.round(n * 10) / 10;
  }

  function formularioPorNome(nome) {
    var lista = printServer.papeis || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].nome === nome) return lista[i];
    }
    return null;
  }

  function rotuloFormulario(p) {
    return p.larguraMm + " × " + p.alturaMm + " mm — " + p.nome;
  }

  /* Valor guardado na configuração -> opção do seletor. */
  function opcaoPapelDe(cfg) {
    cfg = cfg || {};
    if (cfg.papelNome) return "driver:" + cfg.papelNome;
    return papelValido(cfg.papelPadrao) ? cfg.papelPadrao : "personalizado";
  }

  /* Opção do seletor -> dados para salvar/imprimir. */
  function detalhesPapel(opcao, largura, altura) {
    var nome = nomePapelDriver(opcao);
    var form = nome ? formularioPorNome(nome) : null;
    var fixo = nome ? null : (MEDIDAS_PAPEIS[opcao] || null);
    return {
      opcao: papelValido(opcao) ? opcao : "personalizado",
      papel: nome ? "personalizado" : (papelValido(opcao) ? opcao : "personalizado"),
      papelNome: nome,
      formulario: form,
      larguraMm: form ? form.larguraMm : (fixo ? fixo.larguraMm : largura),
      alturaMm: form ? form.alturaMm : (fixo ? fixo.alturaMm : altura)
    };
  }

  function dimensoesDaConfig() {
    var cfg = CFG.impressao || {};
    var opcao = opcaoPapelDe(cfg);
    var det = detalhesPapel(
      opcao,
      medidaMm(cfg.larguraMm, 20, 300) || 72,
      medidaMm(cfg.alturaMm, 20, 1000) || 297
    );
    det.larguraMm = medidaMm(det.larguraMm, 20, 300) || 72;
    det.alturaMm = medidaMm(det.alturaMm, 20, 1000) || 297;
    return det;
  }

  function preencherOpcoesPapel(sel, selecionado) {
    if (!sel) return;

    var atual = papelValido(selecionado) ? selecionado : "personalizado";
    sel.innerHTML = "";

    var formas = (printServer.papeis || []).slice().sort(function (a, b) {
      return (a.larguraMm - b.larguraMm) || (a.alturaMm - b.alturaMm);
    });

    if (formas.length) {
      var grupo = document.createElement("optgroup");
      grupo.label = "Formulários da impressora";
      formas.forEach(function (p) {
        var opt = document.createElement("option");
        opt.value = "driver:" + p.nome;
        opt.textContent = rotuloFormulario(p);
        grupo.appendChild(opt);
      });
      sel.appendChild(grupo);
    }

    var grupoLivre = document.createElement("optgroup");
    grupoLivre.label = "Medidas do sistema";
    [
      ["personalizado", "Personalizado (largura e altura livres)"],
      ["80mm", "Bobina 80 mm — 72 × 297 mm"],
      ["58mm", "Bobina 58 mm — 58 × 110 mm"],
      ["a6", "A6 — 105 × 148 mm"]
    ].forEach(function (par) {
      var opt = document.createElement("option");
      opt.value = par[0];
      opt.textContent = par[1];
      grupoLivre.appendChild(opt);
    });
    sel.appendChild(grupoLivre);

    /* Formulário salvo que sumiu do driver: mantém visível para não perder a escolha. */
    if (ehPapelDriver(atual) && !formularioPorNome(nomePapelDriver(atual))) {
      var perdido = document.createElement("option");
      perdido.value = atual;
      perdido.textContent = nomePapelDriver(atual) + " (formulário não encontrado)";
      sel.appendChild(perdido);
    }

    sel.value = atual;
    if (sel.value !== atual) sel.value = "personalizado";
  }

  function lerMedidaLivreConfig() {
    if (el.settingsPaperW) {
      var largura = medidaMm(el.settingsPaperW.value, 20, 300);
      if (largura !== null) papelLivreConfig.larguraMm = largura;
    }
    if (el.settingsPaperH) {
      var altura = medidaMm(el.settingsPaperH.value, 20, 1000);
      if (altura !== null) papelLivreConfig.alturaMm = altura;
    }
  }

  function atualizarCamposPapelConfig() {
    var opcao = el.settingsPaper ? el.settingsPaper.value : "personalizado";
    var personalizado = opcao === "personalizado";

    /* Ao sair do personalizado, guarda o que estava digitado. */
    if (ultimaOpcaoPapelConfig === "personalizado") lerMedidaLivreConfig();
    ultimaOpcaoPapelConfig = opcao;

    var det = personalizado
      ? papelLivreConfig
      : detalhesPapel(opcao, papelLivreConfig.larguraMm, papelLivreConfig.alturaMm);

    if (el.settingsPaperW) {
      el.settingsPaperW.value = det.larguraMm;
      el.settingsPaperW.disabled = !personalizado;
    }
    if (el.settingsPaperH) {
      el.settingsPaperH.value = det.alturaMm;
      el.settingsPaperH.disabled = !personalizado;
    }
    if (el.settingsPaperHint) {
      setText(el.settingsPaperHint, personalizado
        ? "Etiqueta padrão: 72 × 100 mm. Ajuste a largura e a altura em milímetros."
        : "Medida do papel selecionado. Escolha “Personalizado” para alterar.");
    }
  }

  function papelParaCss(opcao) {
    return ehPapelDriver(opcao) ? "personalizado" : opcao;
  }

  function aplicarConfig() {
    var producao = !!(window.GMAdapter && (GMAdapter.modo === "real" || GMAdapter.modo === "maestro"));

    setText(el.modeChip, producao ? "Produção" : "Simulação");
    if (el.modeChip) el.modeChip.setAttribute("data-mode", producao ? "real" : "sim");
    if (el.simBanner) el.simBanner.hidden = producao;
    setText(el.footerMode, producao
      ? (GMAdapter.modo === "maestro" ? "Integrado ao Maestro" : "Integração autorizada")
      : "Ambiente de simulação");

    var dims = dimensoesDaConfig();
    preencherOpcoesPapel(el.settingsPaper, dims.opcao);
    if (el.settingsPaperW) el.settingsPaperW.value = dims.larguraMm;
    if (el.settingsPaperH) el.settingsPaperH.value = dims.alturaMm;
    atualizarCamposPapelConfig();
    document.body.setAttribute("data-paper", papelParaCss(dims.opcao));
    if (el.printRoot) el.printRoot.setAttribute("data-paper", papelParaCss(dims.opcao));

    if (el.serviceCallout) {
      el.serviceCallout.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3 5 6v5c0 4.5 3 7.8 7 10 4-2.2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>' +
        '<p>O sistema só considera a operação concluída quando o Maestro confirma. ' +
        (modoMaestro()
          ? "As respostas de segurança são enviadas direto à API oficial, dentro deste atendimento.</p>"
          : "Se o site exigir CAPTCHA ou confirmação manual, o atendimento é interrompido para intervenção do operador.</p>");
    }
  }

  /* ---------------- navegação ---------------- */

  function showView(nome) {
    state.view = nome;
    if (el.viewHome) el.viewHome.hidden = nome !== "home";
    if (el.viewService) el.viewService.hidden = nome !== "service";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function focar(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) { /* ignora */ } }
  }

  /* ---------------- abertura de procedimento ---------------- */

  function abrirOpcao(chave) {
    var op = OPCOES[chave];
    if (!op || state.running) return;

    cancelarDescansoAposImpressao();
    limparResultado();
    limparCamposSenha();
    limparQuestoes();
    state.colaborador = null;
    state.opcao = chave;
    state.passos = modoMaestro() ? passosMaestro(op) : op.passos.slice();

    setText(el.serviceEyebrow, op.indice);
    setText(el.serviceTitle, op.titulo);
    setText(el.serviceDesc, op.desc);
    if (el.serviceIcon) el.serviceIcon.innerHTML = op.icone;

    construirFormulario();
    renderTimeline();

    if (el.btnRunLabel) {
      el.btnRunLabel.textContent = modoMaestro() ? "Continuar" : "Iniciar procedimento";
    }
    if (el.serviceNote) setText(el.serviceNote, notaDoFluxo(op));

    if (el.serviceForm) el.serviceForm.hidden = false;
    if (el.serviceProgress) el.serviceProgress.hidden = true;
    if (el.serviceResult) el.serviceResult.hidden = true;
    if (el.serviceCallout) el.serviceCallout.hidden = false;
    clearError(el.serviceError);

    if (!window.GMVault || !GMVault.disponivel()) {
      showError(el.serviceError,
        "Este aplicativo não oferece criptografia segura. Atualize o Android ou reinstale o APK.");
    }

    showView("service");
    setTimeout(function () { focar(el.serviceTitle); }, 60);
  }

  function construirFormulario() {
    if (!el.serviceFields) return;
    el.serviceFields.innerHTML = "";
    state.camposAtivos = [];
    state.elPass = null;
    state.elPass2 = null;

    el.serviceFields.appendChild(criarBlocoIdentificacao());

    (CFG.camposExtras || []).forEach(function (def) {
      el.serviceFields.appendChild(criarCampo(def));
    });

    if (state.opcao === "escolher-senha") {
      el.serviceFields.appendChild(criarCamposSenha());
      state.elPass = document.getElementById("svc-pass");
      state.elPass2 = document.getElementById("svc-pass2");

      [state.elPass, state.elPass2].forEach(function (input) {
        if (!input) return;
        input.addEventListener("input", atualizarRegrasSenha);
      });

      atualizarRegrasSenha();
    }
  }

  function criarBlocoIdentificacao() {
    var wrap = document.createElement("div");
    wrap.className = "id-block";

    var vinculos = Array.isArray(CFG.vinculos) && CFG.vinculos.length ? CFG.vinculos : [
      "Colaborador (CLT)",
      "Franqueado APIX",
      "Motorista terceiro",
      "Promotor de vendas externo",
      "Armazzem - Emp. licenciada",
      "Camiño (Carcará ou Dom Eliseu) - Emp. licenciada",
      "Casa do Arroz - Emp. licenciada"
    ];

    wrap.innerHTML =
      '<div class="id-block-head">' +
        '<span class="id-block-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.4a3.6 3.6 0 0 1 6.4 0"/><path d="M15 10h3.2M15 13.5h3.2"/></svg>' +
        '</span>' +
        '<div>' +
          '<h2>Identificação</h2>' +
          '<p>Informe o vínculo e o CPF do colaborador. Os demais dados são pedidos na hora da redefinição.</p>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label for="svc-vinculo">Quem sou eu</label>' +
        '<select id="svc-vinculo" name="vinculo" class="input">' +
          '<option value="">Selecione o vínculo</option>' +
        '</select>' +
        '<p class="field-hint">Como o colaborador acessa o Maestro.</p>' +
      '</div>' +
      '<div class="field">' +
        '<label for="svc-cpf">CPF</label>' +
        '<input id="svc-cpf" name="cpf" class="input" type="text" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="000.000.000-00">' +
        '<p class="field-hint">Usado somente neste atendimento. Não é impresso.</p>' +
      '</div>';

    var select = wrap.querySelector("#svc-vinculo");
    if (select) {
      vinculos.forEach(function (nome) {
        var opt = document.createElement("option");
        opt.value = nome;
        opt.textContent = nome;
        select.appendChild(opt);
      });
      select.addEventListener("change", function () {
        select.classList.remove("is-invalid");
        select.removeAttribute("aria-invalid");
        clearError(el.serviceError);
      });
    }

    var input = wrap.querySelector("#svc-cpf");
    if (input) {
      input.addEventListener("input", function () {
        input.value = maskCpf(input.value);
        input.classList.remove("is-invalid");
        input.removeAttribute("aria-invalid");
        clearError(el.serviceError);
      });
    }

    return wrap;
  }

  function criarCampo(def) {
    var wrap = document.createElement("div");
    wrap.className = "field";

    var label = document.createElement("label");
    label.setAttribute("for", "svc-" + def.id);
    label.textContent = def.label + (def.obrigatorio ? "" : " (opcional)");
    wrap.appendChild(label);

    var input;
    if (def.tipo === "select") {
      input = document.createElement("select");
      (def.opcoes || []).forEach(function (opt) {
        var o = document.createElement("option");
        o.value = typeof opt === "string" ? opt : opt.valor;
        o.textContent = typeof opt === "string" ? opt : opt.rotulo;
        input.appendChild(o);
      });
    } else {
      input = document.createElement("input");
      input.type = def.tipo === "date" ? "date" : (def.tipo === "tel" ? "tel" : (def.tipo === "number" ? "number" : "text"));
      if (def.placeholder) input.placeholder = def.placeholder;
      if (def.maxlength) input.maxLength = def.maxlength;
    }
    input.id = "svc-" + def.id;
    input.name = def.id;
    input.className = "input";
    input.autocomplete = "off";
    input.setAttribute("data-campo", def.id);
    wrap.appendChild(input);

    if (def.ajuda) {
      var hint = document.createElement("p");
      hint.className = "field-hint";
      hint.textContent = def.ajuda;
      wrap.appendChild(hint);
    }

    state.camposAtivos.push({ def: def, input: input });
    return wrap;
  }

  function criarCamposSenha() {
    var wrap = document.createElement("div");
    wrap.className = "password-block";
    var max = Number((CFG.senha || {}).max) || 20;

    wrap.innerHTML =
      '<div class="field">' +
        '<label for="svc-pass">Senha desejada</label>' +
        '<div class="input-row">' +
          '<input id="svc-pass" class="input" type="password" autocomplete="new-password" spellcheck="false" maxlength="' + max + '" placeholder="Digite a nova senha">' +
          '<button type="button" class="btn btn-eye" data-toggle="svc-pass" aria-pressed="false">Mostrar</button>' +
        '</div>' +
        '<ul class="rules" id="svc-rules" aria-live="polite"></ul>' +
      '</div>' +
      '<div class="field">' +
        '<label for="svc-pass2">Confirmar senha</label>' +
        '<div class="input-row">' +
          '<input id="svc-pass2" class="input" type="password" autocomplete="new-password" spellcheck="false" maxlength="' + max + '" placeholder="Digite novamente">' +
          '<button type="button" class="btn btn-eye" data-toggle="svc-pass2" aria-pressed="false">Mostrar</button>' +
        '</div>' +
        '<p class="field-hint" id="svc-match" hidden>As senhas não conferem.</p>' +
      '</div>' +
      '<p class="micro-note">O Maestro é a autoridade final sobre a senha. Se ele recusar, o sistema não conclui a operação.</p>';

    return wrap;
  }

  function atualizarRegrasSenha() {
    var lista = document.getElementById("svc-rules");
    if (!lista || !state.elPass) return;

    var senha = state.elPass.value;
    var regras = regrasSenha(senha);
    lista.innerHTML = "";
    regras.forEach(function (r) {
      var li = document.createElement("li");
      li.className = senha && r.ok ? "ok" : "";
      li.textContent = r.texto;
      lista.appendChild(li);
    });

    var aviso = document.getElementById("svc-match");
    if (aviso) {
      var conf = state.elPass2 ? state.elPass2.value : "";
      aviso.hidden = !conf || conf === senha;
    }
  }

  function alternarCampo(btn) {
    var id = btn.getAttribute("data-toggle");
    var input = document.getElementById(id);
    if (!input) return;
    var mostrar = input.type === "password";
    input.type = mostrar ? "text" : "password";
    btn.textContent = mostrar ? "Ocultar" : "Mostrar";
    btn.setAttribute("aria-pressed", mostrar ? "true" : "false");
  }

  /* ---------------- perguntas de segurança do Maestro ---------------- */

  function maskData(v) {
    var d = onlyDigits(v).slice(0, 8);
    if (d.length > 4) return d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
    if (d.length > 2) return d.slice(0, 2) + "/" + d.slice(2);
    return d;
  }

  /* "11/06/2003" -> "2003-06-11" (formato exigido pela API). */
  function dataParaIso(valor) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor || "").trim());
    if (!m) return "";
    var dia = Number(m[1]);
    var mes = Number(m[2]);
    var ano = Number(m[3]);
    if (mes < 1 || mes > 12 || dia < 1) return "";
    var dt = new Date(ano, mes - 1, dia);
    if (dt.getFullYear() !== ano || dt.getMonth() !== mes - 1 || dt.getDate() !== dia) return "";
    if (dt.getTime() > Date.now()) return "";
    return m[3] + "-" + m[2] + "-" + m[1];
  }

  function travarIdentificacao(travar) {
    var v = document.getElementById("svc-vinculo");
    var c = document.getElementById("svc-cpf");
    if (v) v.disabled = !!travar;
    if (c) c.readOnly = !!travar;
    var bloco = document.querySelector(".id-block");
    if (bloco) bloco.classList.toggle("is-locked", !!travar);
  }

  function renderQuestoes() {
    var anterior = document.getElementById("svc-questoes");
    if (anterior && anterior.parentNode) anterior.parentNode.removeChild(anterior);
    if (!el.serviceFields || !state.questoes.length) return;

    var bloco = document.createElement("div");
    bloco.className = "question-block";
    bloco.id = "svc-questoes";

    var head = document.createElement("div");
    head.className = "id-block-head";
    head.innerHTML =
      '<span class="id-block-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 3 5 6v5c0 4.5 3 7.8 7 10 4-2.2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>' +
      '</span>' +
      '<div>' +
        '<h2>Confirmação de identidade</h2>' +
        '<p>Responda exatamente como consta no cadastro do Maestro. Datas no formato dia/mês/ano.</p>' +
      '</div>';
    bloco.appendChild(head);

    state.questoes.forEach(function (q, i) {
      var field = document.createElement("div");
      field.className = "field";

      var label = document.createElement("label");
      label.setAttribute("for", "svc-q" + q.id);
      label.textContent = (i + 1) + ". " + q.questao;
      field.appendChild(label);

      var input;
      if (q.tipo === "MULTIPLA_ESCOLHA" && q.alternativas.length) {
        input = document.createElement("select");
        input.className = "input";
        var vazio = document.createElement("option");
        vazio.value = "";
        vazio.textContent = "Selecione uma opção";
        input.appendChild(vazio);
        q.alternativas.forEach(function (alt) {
          var o = document.createElement("option");
          o.value = alt;
          o.textContent = alt;
          input.appendChild(o);
        });
      } else {
        input = document.createElement("input");
        input.type = "tel";
        input.className = "input";
        input.autocomplete = "off";
        input.placeholder = q.placeholder || "";
        if (q.tipoEntrada === "DATA") {
          input.maxLength = 10;
          input.inputMode = "numeric";
          input.addEventListener("input", function () { input.value = maskData(input.value); });
        }
      }

      input.id = "svc-q" + q.id;
      input.name = "q" + q.id;
      input.setAttribute("data-questao", String(q.id));
      input.addEventListener("input", function () {
        input.classList.remove("is-invalid");
        input.removeAttribute("aria-invalid");
        clearError(el.serviceError);
      });
      input.addEventListener("change", function () {
        input.classList.remove("is-invalid");
        input.removeAttribute("aria-invalid");
        clearError(el.serviceError);
      });

      field.appendChild(input);
      bloco.appendChild(field);
    });

    el.serviceFields.appendChild(bloco);
  }

  function validarRespostas() {
    var respostas = [];
    var primeiro = null;

    for (var i = 0; i < state.questoes.length; i++) {
      var q = state.questoes[i];
      var input = document.getElementById("svc-q" + q.id);
      if (!input) {
        return { erro: "Não foi possível ler as perguntas de segurança. Refaça o procedimento." };
      }

      var valor = String(input.value || "").trim();
      input.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");

      var invalido = !valor;
      var resposta = valor;

      if (!invalido && q.tipoEntrada === "DATA") {
        var iso = dataParaIso(valor);
        if (!iso) invalido = true;
        else resposta = iso;
      }

      if (!invalido && q.tipo === "MULTIPLA_ESCOLHA" && q.alternativas.indexOf(valor) < 0) {
        invalido = true;
      }

      if (invalido) {
        input.classList.add("is-invalid");
        input.setAttribute("aria-invalid", "true");
        if (!primeiro) primeiro = input;
        continue;
      }

      respostas.push({ id: q.id, questao: q.questao, resposta: resposta });
    }

    if (primeiro) {
      focar(primeiro);
      return { erro: "Confira as respostas destacadas. Use o formato dia/mês/ano nas datas." };
    }
    if (!respostas.length) {
      return { erro: "Responda as perguntas de segurança." };
    }

    return { erro: null, respostas: respostas };
  }

  function limparQuestoes() {
    state.questoes = [];
    state.questionarioId = "";
    var bloco = document.getElementById("svc-questoes");
    if (bloco && bloco.parentNode) bloco.parentNode.removeChild(bloco);
    travarIdentificacao(false);
  }

  /* Etapa 1 do fluxo real: busca no Maestro as perguntas de segurança. */
  async function carregarQuestoes(op) {
    setRunning(true);
    travarIdentificacao(true);
    marcarEtapa(0, "done");
    marcarEtapa(1, "running");

    try {
      var dados = await GMAdapter.carregarQuestionario({
        cpf: state.colaborador.cpf,
        vinculo: state.colaborador.vinculo,
        reseta: op.reseta
      });

      var lista = Array.isArray(dados.questoes) ? dados.questoes : [];
      state.questionarioId = String(dados.id || "");
      state.questoes = lista.map(function (q) {
        return {
          id: q.id,
          questao: String(q.questao || "Pergunta de segurança"),
          tipo: String(q.tipo || "ENTRADA_MANUAL"),
          tipoEntrada: String(q.tipoEntrada || ""),
          placeholder: String(q.placeholder || ""),
          alternativas: Array.isArray(q.alternativas) ? q.alternativas.map(String) : []
        };
      });

      marcarEtapa(1, "done");
      marcarEtapa(2, "running");

      renderQuestoes();
      setRunning(false);

      if (el.btnRunLabel) el.btnRunLabel.textContent = "Confirmar respostas";
      if (el.serviceNote) {
        setText(el.serviceNote,
          "Confira as respostas antes de enviar. Se o Maestro recusar, o atendimento recomeça.");
      }

      clearError(el.serviceError);
      var primeiro = document.querySelector("#svc-questoes input, #svc-questoes select");
      setTimeout(function () {
        if (primeiro) focar(primeiro);
        var bloco = document.getElementById("svc-questoes");
        if (bloco && bloco.scrollIntoView) bloco.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);

    } catch (err) {
      marcarEtapaComErro();
      limparQuestoes();
      setRunning(false);
      showError(el.serviceError, mensagemErro(err) +
        " Nenhum dado foi alterado. Confira o vínculo e o CPF e tente de novo.");
    }
  }

  /* ---------------- validação e execução ---------------- */

  function validarIdentidade() {
    var vinculoEl = document.getElementById("svc-vinculo");
    var input = document.getElementById("svc-cpf");

    if (!vinculoEl || !input) {
      return { erro: "Campos de identificação não encontrados. Volte ao início e abra o procedimento novamente." };
    }

    var vinculo = String(vinculoEl.value || "").trim();
    vinculoEl.classList.remove("is-invalid");
    vinculoEl.removeAttribute("aria-invalid");

    if (!vinculo) {
      vinculoEl.classList.add("is-invalid");
      vinculoEl.setAttribute("aria-invalid", "true");
      focar(vinculoEl);
      return { erro: "Selecione o vínculo do colaborador em “Quem sou eu”." };
    }

    var cpf = onlyDigits(input.value);
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");

    if (!cpf) {
      input.classList.add("is-invalid");
      input.setAttribute("aria-invalid", "true");
      focar(input);
      return { erro: "Informe o CPF do colaborador." };
    }
    if (!cpfValido(cpf)) {
      input.classList.add("is-invalid");
      input.setAttribute("aria-invalid", "true");
      focar(input);
      return { erro: "CPF inválido. Confira os 11 dígitos e digite novamente." };
    }

    input.value = maskCpf(cpf);
    return { cpf: cpf, vinculo: vinculo };
  }

  function validarFormulario() {
    var dados = {};
    var primeiroInvalido = null;

    state.camposAtivos.forEach(function (item) {
      var valor = String(item.input.value || "").trim();
      item.input.classList.remove("is-invalid");
      item.input.removeAttribute("aria-invalid");

      var invalido = false;
      if (item.def.obrigatorio && !valor) invalido = true;
      if (valor && item.def.tipo === "date" && isNaN(new Date(valor + "T00:00:00").getTime())) invalido = true;

      if (invalido) {
        item.input.classList.add("is-invalid");
        item.input.setAttribute("aria-invalid", "true");
        if (!primeiroInvalido) primeiroInvalido = item.input;
      }
      dados[item.def.id] = valor;
    });

    if (primeiroInvalido) {
      focar(primeiroInvalido);
      return { erro: "Preencha corretamente os campos obrigatórios destacados.", dados: dados };
    }

    if (state.opcao === "escolher-senha") {
      var senha = state.elPass ? state.elPass.value : "";
      var conf = state.elPass2 ? state.elPass2.value : "";

      if (!senha) {
        if (state.elPass) { state.elPass.classList.add("is-invalid"); focar(state.elPass); }
        return { erro: "Digite a senha desejada.", dados: dados };
      }

      var faltando = regrasSenha(senha).filter(function (r) { return !r.ok; });
      if (faltando.length) {
        focar(state.elPass);
        return {
          erro: "A senha não atende aos critérios: " +
            faltando.map(function (r) { return r.texto.toLowerCase(); }).join("; ") + ".",
          dados: dados
        };
      }
      if (senha === state.colaborador.cpf) {
        focar(state.elPass);
        return { erro: "A senha não pode ser igual ao CPF do colaborador.", dados: dados };
      }
      if (senha !== conf) {
        focar(state.elPass2);
        return { erro: "As senhas não conferem. Digite a mesma senha nos dois campos.", dados: dados };
      }
    }

    return { erro: null, dados: dados };
  }

  function checarTentativas(cpf) {
    var max = Number((CFG.tentativas || {}).max) || 3;
    var janela = (Number((CFG.tentativas || {}).janelaMinutos) || 15) * 60000;
    var reg = state.tentativas[cpf];

    if (reg && Date.now() - reg.inicio > janela) {
      delete state.tentativas[cpf];
      reg = null;
    }
    if (!reg) return { ok: true, restantes: max };
    if (reg.falhas >= max) {
      var minutos = Math.max(1, Math.ceil((janela - (Date.now() - reg.inicio)) / 60000));
      return { ok: false, minutos: minutos };
    }
    return { ok: true, restantes: max - reg.falhas };
  }

  function registrarFalha() {
    var cpf = state.colaborador.cpf;
    var janela = (Number((CFG.tentativas || {}).janelaMinutos) || 15) * 60000;
    var max = Number((CFG.tentativas || {}).max) || 3;
    var reg = state.tentativas[cpf];

    if (!reg || Date.now() - reg.inicio > janela) {
      reg = state.tentativas[cpf] = { falhas: 0, inicio: Date.now() };
    }
    reg.falhas++;
    return Math.max(0, max - reg.falhas);
  }

  function mensagemErro(err) {
    if (!err) return "Não foi possível concluir a operação.";
    if (err.code === "SIM_FAIL") {
      return err.message + " Tente novamente ou acione o operador autorizado.";
    }
    return err.message || "Não foi possível concluir a operação.";
  }

  async function executar(ev) {
    if (ev) ev.preventDefault();
    if (state.running) return;

    clearError(el.serviceError);

    var op = OPCOES[state.opcao];
    if (!op) return;

    var ident = validarIdentidade();
    if (ident.erro) {
      showError(el.serviceError, ident.erro);
      return;
    }

    state.colaborador = { cpf: ident.cpf, vinculo: ident.vinculo };

    var validacao = validarFormulario();
    if (validacao.erro) {
      showError(el.serviceError, validacao.erro);
      return;
    }

    var gate = checarTentativas(ident.cpf);
    if (!gate.ok) {
      showError(el.serviceError,
        "Limite de tentativas atingido para este CPF. Aguarde " + gate.minutos +
        " minuto(s) ou acione o operador autorizado.");
      return;
    }

    /* Fluxo oficial em duas etapas:
       1) busca as perguntas de segurança no Maestro;
       2) envia as respostas e só então conclui. */
    if (modoMaestro() && !state.questionarioId) {
      await carregarQuestoes(op);
      return;
    }

    var respostas = null;
    if (modoMaestro()) {
      var conferencia = validarRespostas();
      if (conferencia.erro) {
        showError(el.serviceError, conferencia.erro);
        return;
      }
      respostas = conferencia.respostas;
    }

    var senha = null;
    var box = null;

    setRunning(true, modoMaestro());

    try {
      if (op.reseta) {
        senha = op.geraSenha ? gerarSenhaValida() : (state.elPass ? state.elPass.value : "");
        /* Criptografa antes de qualquer contato com o Maestro. */
        box = await GMVault.protect(senha);
      }

      var ctx = {
        cpf: state.colaborador.cpf,
        vinculo: state.colaborador.vinculo,
        dados: validacao.dados,
        senha: senha,
        passos: state.passos,
        onStep: marcarEtapa
      };

      var res;
      if (modoMaestro()) {
        marcarEtapa(2, "done");
        ctx.respostas = respostas;
        ctx.questionarioId = state.questionarioId;
        ctx.reseta = op.reseta;
        ctx.etapaGm = 3;
        ctx.etapaSenha = 4;
        ctx.etapaFim = 5;
        res = await GMAdapter.concluir(ctx);
      } else {
        res = op.reseta
          ? await GMAdapter.redefinirSenha(ctx)
          : await GMAdapter.recuperarGmId(ctx);
      }

      if (!res || res.confirmado !== true || !res.gmId) {
        throw new Error("O Maestro não confirmou a operação. Nada foi considerado concluído.");
      }

      state.gmId = String(res.gmId);
      state.protocolo = res.protocolo
        ? (modoMaestro() ? String(res.protocolo).slice(0, 8).toUpperCase() : String(res.protocolo))
        : "—";
      state.simulado = res.simulado === true;

      if (op.reseta) {
        state.senhaBox = box;
        state.senhaTamanho = senha.length;
        box = null;
      }

      delete state.tentativas[state.colaborador.cpf];
      registrarLog("sucesso", state.protocolo);
      limparCamposSenha();
      mostrarResultado();

      /* Comprovante sai sozinho na impressora configurada em todas as
         opcoes: redefinicao (GM ID + senha) e Lembrar GM ID (somente GM ID).
         Se a impressao direta falhar, a senha permanece na tela e o botao
         IMPRIMIR continua disponivel. */
      if (CFG.impressao && CFG.impressao.modo === "direto") {
        setTimeout(function () { imprimirAposOperacao(); }, 900);
      }

    } catch (err) {
      if (box) { GMVault.destroyBox(box); box = null; }
      marcarEtapaComErro();

      var restantes = registrarFalha();
      registrarLog("falha", "—");

      setRunning(false);

      /* O questionário do Maestro é de uso único: para tentar de novo é
         preciso buscar novas perguntas. */
      if (modoMaestro()) {
        limparQuestoes();
        if (el.btnRunLabel) el.btnRunLabel.textContent = "Continuar";
        if (el.serviceNote) setText(el.serviceNote, notaDoFluxo(op));
      }

      if (el.serviceForm) el.serviceForm.hidden = false;
      if (el.serviceProgress) el.serviceProgress.hidden = true;

      var msg = mensagemErro(err);
      if (restantes > 0) {
        msg += " Tentativa(s) restante(s): " + restantes + ".";
      } else {
        msg += " Limite de tentativas atingido; acione o operador autorizado.";
      }
      showError(el.serviceError, msg);
      focar(el.serviceError);

    } finally {
      senha = null;
    }
  }

  function setRunning(rodando, manterEtapas) {
    state.running = rodando;
    if (el.serviceForm) el.serviceForm.hidden = rodando;
    if (el.serviceProgress) el.serviceProgress.hidden = !rodando;
    if (el.serviceResult) el.serviceResult.hidden = true;
    if (el.btnRun) el.btnRun.disabled = rodando;
    if (el.serviceCallout) el.serviceCallout.hidden = rodando;

    if (rodando) {
      clearError(el.serviceError);
      if (el.progressLabel) el.progressLabel.textContent = "Preparando a operação…";
      if (!manterEtapas) renderTimeline();
    }
  }

  /* ---------------- etapas ---------------- */

  function renderTimeline() {
    if (!el.timeline) return;
    el.timeline.innerHTML = "";
    state.passos.forEach(function (texto, i) {
      var li = document.createElement("li");
      li.setAttribute("data-status", "pending");

      var dot = document.createElement("span");
      dot.className = "t-dot";
      dot.textContent = String(i + 1);

      var label = document.createElement("span");
      label.className = "t-label";
      label.textContent = texto;

      li.appendChild(dot);
      li.appendChild(label);
      el.timeline.appendChild(li);
    });
  }

  function marcarEtapa(indice, status) {
    var li = el.timeline ? el.timeline.children[indice] : null;
    if (li) {
      li.setAttribute("data-status", status);
      var dot = li.querySelector(".t-dot");
      if (dot && status === "done") dot.textContent = "✓";
    }
    if (status === "running" && el.progressLabel) {
      var texto = state.passos[indice] || "";
      el.progressLabel.textContent = "Etapa " + (indice + 1) + " de " + state.passos.length + " · " + texto;
    }
  }

  function marcarEtapaComErro() {
    if (!el.timeline) return;
    var atual = el.timeline.querySelector('li[data-status="running"]');
    if (atual) {
      atual.setAttribute("data-status", "error");
      var dot = atual.querySelector(".t-dot");
      if (dot) dot.textContent = "!";
    }
  }

  /* ---------------- resultado ---------------- */

  function mostrarResultado() {
    var op = OPCOES[state.opcao];
    setRunning(false);
    if (el.serviceForm) el.serviceForm.hidden = true;
    if (el.serviceProgress) el.serviceProgress.hidden = true;
    if (el.serviceResult) el.serviceResult.hidden = false;
    if (el.serviceCallout) el.serviceCallout.hidden = false;

    var sim = state.simulado === true;

    setText(el.resultTitle, op.reseta
      ? (sim ? "Simulação concluída" : "Senha redefinida")
      : (sim ? "GM ID simulado" : "GM ID localizado"));
    setText(el.resultSub, sim
      ? "MODO SIMULAÇÃO: nada foi alterado no Maestro. O GM ID e a senha abaixo são fictícios e o comprovante sai marcado como SIMULADO."
      : (op.reseta
        ? "O Maestro confirmou a redefinição. O comprovante com GM ID e senha sai na impressora configurada."
        : "O Maestro confirmou a consulta. O comprovante com o GM ID sai na impressora configurada."));

    setText(el.resultGm, state.gmId);
    setText(el.resultProtocol, state.protocolo);

    if (op.reseta) {
      if (el.resultPassRow) el.resultPassRow.hidden = false;
      if (el.resultPass) {
        el.resultPass.textContent = "•".repeat(Math.max(6, state.senhaTamanho));
        el.resultPass.setAttribute("data-revealed", "false");
      }
      if (el.btnRevealPass) el.btnRevealPass.hidden = false;
      setText(el.revealLabel, "Mostrar");
      setText(el.resultNote, sim
        ? "Comprovante marcado como SIMULADO: não use estes dados para acesso."
        : "A senha será apagada da tela e da memória assim que a impressão for confirmada.");
    } else {
      if (el.resultPassRow) el.resultPassRow.hidden = true;
      if (el.btnRevealPass) el.btnRevealPass.hidden = true;
      setText(el.resultNote, "Nenhuma senha é exibida ou alterada nesta opção.");
    }

    setTimeout(function () {
      if (!el.resultTitle) return;
      el.resultTitle.setAttribute("tabindex", "-1");
      focar(el.resultTitle);
    }, 60);

    toast(sim
      ? "Simulação concluída — nenhum dado real foi alterado."
      : (op.reseta ? "Senha redefinida e confirmada pelo Maestro." : "GM ID recuperado e confirmado pelo Maestro."));
  }

  async function alternarSenha() {
    if (!state.senhaBox) return;
    var revelado = el.resultPass && el.resultPass.getAttribute("data-revealed") === "true";

    if (revelado) {
      el.resultPass.textContent = "•".repeat(Math.max(6, state.senhaTamanho));
      el.resultPass.setAttribute("data-revealed", "false");
      setText(el.revealLabel, "Mostrar");
      return;
    }

    try {
      var senha = await GMVault.reveal(state.senhaBox);
      el.resultPass.textContent = senha;
      el.resultPass.setAttribute("data-revealed", "true");
      setText(el.revealLabel, "Ocultar");
    } catch (e) {
      toast("Não foi possível exibir a senha. Refaça o procedimento.");
    }
  }

  function limparResultado() {
    if (state.senhaBox) {
      GMVault.destroyBox(state.senhaBox);
      state.senhaBox = null;
    }
    state.senhaTamanho = 0;
    state.gmId = "";
    state.protocolo = "";
    state.simulado = false;

    if (el.serviceResult) el.serviceResult.hidden = true;
    if (el.resultPass) { el.resultPass.textContent = ""; el.resultPass.setAttribute("data-revealed", "false"); }
    if (el.resultGm) el.resultGm.textContent = "";
    if (el.resultProtocol) el.resultProtocol.textContent = "";
    if (el.printGm) el.printGm.textContent = "";
    if (el.printPass) el.printPass.textContent = "";
    if (el.printRoot) el.printRoot.classList.remove("is-ready");
  }

  /* ---------------- impressão ---------------- */

  async function imprimirDireto(senha, papel, larguraMm, alturaMm, papelNome) {
    var cfg = CFG.impressao || {};
    var limite = Math.max(3000, Number(cfg.tempoLimiteMs) || 15000);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, limite);

    try {
      var resp = await fetch("imprimir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          impressora: cfg.impressora || "",
          papel: papel,
          papelNome: papelNome || "",
          larguraMm: larguraMm,
          alturaMm: alturaMm,
          gmId: state.gmId,
          senha: senha || "",
          simulado: state.simulado === true
        }),
        signal: ctrl ? ctrl.signal : undefined
      });

      var dados = null;
      try { dados = await resp.json(); } catch (e) { dados = null; }

      if (!resp.ok || !dados || dados.ok !== true) {
        return { ok: false, erro: (dados && dados.erro) || ("HTTP " + resp.status) };
      }
      return {
        ok: true,
        simulado: dados.simulado === true,
        impressora: dados.impressora || "",
        estado: dados.estado || "",
        saudavel: dados.saudavel !== false
      };
    } catch (e) {
      var motivo = (e && e.name === "AbortError") ? "tempo esgotado" : "impressora indisponível";
      return { ok: false, erro: motivo };
    } finally {
      clearTimeout(timer);
    }
  }

  /* Impressão automática ao concluir qualquer opção:
     - redefinição de senha: GM ID + senha;
     - Lembrar GM ID: somente o GM ID.
     A senha só é removida da memória quando o servidor confirma que o
     trabalho entrou na fila e a impressora está saudável. */
  async function imprimirAposOperacao() {
    var op = OPCOES[state.opcao];
    var reseta = !!(op && op.reseta);

    if (state.running || !state.gmId) return;
    if ((CFG.impressao && CFG.impressao.modo) !== "direto") return;

    var senha = "";
    if (reseta) {
      if (!state.senhaBox) return;
      try {
        senha = await GMVault.reveal(state.senhaBox);
      } catch (e) {
        toast("Não foi possível preparar a impressão automática. Use o botão IMPRIMIR.");
        return;
      }
    }

    var dims = dimensoesDaConfig();
    var direto = await imprimirDireto(senha, dims.papel, dims.larguraMm, dims.alturaMm, dims.papelNome);
    senha = null;

    if (!direto.ok) {
      toast(reseta
        ? "GM ID e senha não foram impressos (" + direto.erro +
          "). A senha continua na tela: use IMPRIMIR para tentar de novo."
        : "GM ID não foi impresso (" + direto.erro +
          "). Use IMPRIMIR para tentar de novo.");
      return;
    }

    /* Trabalho aceito, mas a impressora está em erro/offline: nada saiu no papel.
       Mantém a senha na tela para o atendente agir (liberar a impressora). */
    if (direto.saudavel === false) {
      toast((reseta ? "A senha foi redefinida, mas a impressora" : "O GM ID foi recuperado, mas a impressora") +
        (direto.impressora ? " " + direto.impressora : "") +
        " está em " + (direto.estado || "erro") + " e o comprovante ficou na fila. " +
        (reseta ? "A senha continua na tela: corrija a impressora e use IMPRIMIR." : "Corrija a impressora e use IMPRIMIR."));
      return;
    }

    if (reseta) finalizarImpressao();
    agendarDescansoAposImpressao();
    toast(direto.simulado
      ? "Modo de teste: comprovante validado, nada foi enviado à impressora."
      : (reseta ? "GM ID e senha enviados para a impressora" : "GM ID enviado para a impressora") +
        (direto.impressora ? " (" + direto.impressora + ")." : "."));
  }

  async function imprimir() {
    if (!state.gmId) {
      toast("Nenhum resultado disponível para impressão.");
      return;
    }
    if (state.running) return;

    var op = OPCOES[state.opcao];
    if (op && op.reseta && !state.senhaBox) {
      toast("A senha já foi removida. Refaça o procedimento para gerar uma nova via.");
      return;
    }

    var senha = "";
    if (state.senhaBox) {
      try {
        senha = await GMVault.reveal(state.senhaBox);
      } catch (e) {
        toast("Não foi possível preparar a senha para impressão. Refaça o procedimento.");
        return;
      }
    }

    if (el.printGm) el.printGm.textContent = state.gmId;
    if (el.printPass) el.printPass.textContent = senha;
    if (el.printPassLine) el.printPassLine.hidden = !senha;

    /* Medida definida em Gestão > Impressora. */
    var det = dimensoesDaConfig();

    if (det.opcao === "personalizado") {
      var larguraOk = medidaMm(det.larguraMm, 20, 300);
      var alturaOk = medidaMm(det.alturaMm, 20, 1000);
      if (larguraOk === null || alturaOk === null) {
        toast("A largura e a altura da etiqueta estão inválidas. Ajuste em Gestão > Impressora.");
        return;
      }
      det.larguraMm = larguraOk;
      det.alturaMm = alturaOk;
    }

    document.body.setAttribute("data-paper", papelParaCss(det.opcao));
    if (el.printRoot) {
      el.printRoot.setAttribute("data-paper", papelParaCss(det.opcao));
      el.printRoot.classList.add("is-ready");
    }

    var modo = (CFG.impressao && CFG.impressao.modo) === "direto" ? "direto" : "navegador";

    if (modo === "direto") {
      var direto = await imprimirDireto(senha, det.papel, det.larguraMm, det.alturaMm, det.papelNome);

      if (direto.ok) {
        if (direto.saudavel === false) {
          if (el.printRoot) el.printRoot.classList.remove("is-ready");
          if (el.printPass) el.printPass.textContent = "";
          toast("A impressora" + (direto.impressora ? " " + direto.impressora : "") +
            " está em " + (direto.estado || "erro") +
            " e o comprovante ficou na fila. A senha continua na tela: corrija a impressora e use IMPRIMIR.");
          return;
        }
        finalizarImpressao();
        agendarDescansoAposImpressao();
        if (el.printRoot) el.printRoot.classList.remove("is-ready");
        if (el.printPass) el.printPass.textContent = "";
        toast(direto.simulado
          ? "Modo de teste: comprovante validado, nada foi enviado à impressora."
          : "Comprovante enviado para a impressora" +
            (direto.impressora ? " (" + direto.impressora + ")." : "."));
        return;
      }

      toast("Impressão direta indisponível (" + direto.erro + "). Abrindo a janela de impressão.");
    }

    window.print();
    if (state.gmId) agendarDescansoAposImpressao();

    /* Fallback: se o navegador não emitir afterprint, limpa ao fechar. */
    setTimeout(function () {
      if (state.senhaBox) finalizarImpressao();
    }, 6000);
  }

  function finalizarImpressao() {
    if (!state.senhaBox) return;
    GMVault.destroyBox(state.senhaBox);
    state.senhaBox = null;
    state.senhaTamanho = 0;

    if (el.resultPass) {
      el.resultPass.textContent = "removida";
      el.resultPass.setAttribute("data-revealed", "false");
    }
    if (el.btnRevealPass) el.btnRevealPass.hidden = true;
    if (el.printPass) el.printPass.textContent = "";
    if (el.printRoot) el.printRoot.classList.remove("is-ready");
    limparCamposSenha();
    setText(el.resultNote, "Senha apagada da tela e da memória. Para uma nova via, refaça o procedimento.");
    toast("Senha removida da tela. Nada foi armazenado.");
  }

  function limparCamposSenha() {
    [document.getElementById("svc-pass"), document.getElementById("svc-pass2")].forEach(function (input) {
      if (!input) return;
      input.value = "";
      input.type = "password";
      input.classList.remove("is-invalid");
    });
    $$("[data-toggle]").forEach(function (btn) {
      btn.textContent = "Mostrar";
      btn.setAttribute("aria-pressed", "false");
    });
    state.elPass = null;
    state.elPass2 = null;
  }

  /* ---------------- ciclo do atendimento ---------------- */

  function voltarInicio() {
    if (state.running) { toast("Aguarde a operação terminar."); return; }
    limparResultado();
    limparCamposSenha();
    limparQuestoes();
    state.colaborador = null;
    state.opcao = null;
    state.passos = [];
    if (el.serviceFields) el.serviceFields.innerHTML = "";
    if (el.timeline) el.timeline.innerHTML = "";
    if (el.btnRunLabel) el.btnRunLabel.textContent = "Iniciar procedimento";
    if (el.serviceNote) setText(el.serviceNote, "");
    clearError(el.serviceError);
    showView("home");
    setTimeout(function () { focar(el.homeTitle); }, 60);
  }

  function limparTudo() {
    limparResultado();
    limparCamposSenha();
    limparQuestoes();

    state.colaborador = null;
    state.opcao = null;
    state.passos = [];
    state.running = false;

    clearError(el.serviceError);

    if (el.serviceFields) el.serviceFields.innerHTML = "";
    if (el.timeline) el.timeline.innerHTML = "";
    if (el.btnRunLabel) el.btnRunLabel.textContent = "Iniciar procedimento";
    if (el.serviceNote) setText(el.serviceNote, "");
    if (el.serviceForm) el.serviceForm.hidden = false;
    if (el.serviceProgress) el.serviceProgress.hidden = true;
    if (el.serviceResult) el.serviceResult.hidden = true;
    if (el.serviceCallout) el.serviceCallout.hidden = true;

    if (window.GMVault) GMVault.destroy();
    showView("home");
  }

  function encerrar(mensagem) {
    if (state.running) { toast("Aguarde a operação terminar."); return; }
    limparTudo();
    toast(mensagem || "Atendimento encerrado. Os dados foram apagados.");
    setTimeout(function () { focar(el.homeTitle); }, 60);
  }

  /* ---------------- registros ---------------- */

  function registrarLog(status, protocolo) {
    if (!state.colaborador || !state.opcao) return;
    state.log.unshift({
      quando: new Date(),
      cpf: mascararCpf(state.colaborador.cpf),
      opcao: OPCOES[state.opcao].nome,
      status: status,
      protocolo: protocolo || "—"
    });
    if (state.log.length > 100) state.log.pop();
    atualizarLogUi();
  }

  function formatarData(d) {
    function p(n) { return String(n).padStart(2, "0"); }
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function atualizarLogUi() {
    if (el.logCount) {
      el.logCount.textContent = String(state.log.length);
      el.logCount.hidden = state.log.length === 0;
    }
    if (!el.logList) return;
    el.logList.innerHTML = "";

    state.log.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "log-item";
      li.setAttribute("data-status", item.status);

      var top = document.createElement("div");
      top.className = "log-top";

      var st = document.createElement("span");
      st.className = "log-status";
      st.textContent = item.status === "sucesso" ? "Sucesso" : "Falha";

      var hora = document.createElement("time");
      hora.textContent = formatarData(item.quando);

      top.appendChild(st);
      top.appendChild(hora);

      var op = document.createElement("p");
      op.className = "log-op";
      op.textContent = item.opcao;

      var meta = document.createElement("p");
      meta.className = "log-meta";
      meta.textContent = "CPF " + item.cpf + " · Protocolo " + item.protocolo;

      li.appendChild(top);
      li.appendChild(op);
      li.appendChild(meta);
      el.logList.appendChild(li);
    });

    if (el.logEmpty) el.logEmpty.hidden = state.log.length > 0;
  }

  function abrirLog() {
    state.lastFocus = document.activeElement;
    if (el.drawer) el.drawer.hidden = false;
    if (el.drawerBackdrop) el.drawerBackdrop.hidden = false;
    atualizarLogUi();
    var fechar = $('[data-action="close-log"]', el.drawer);
    if (fechar) setTimeout(function () { focar(fechar); }, 40);
  }

  function fecharLog() {
    if (el.drawer) el.drawer.hidden = true;
    if (el.drawerBackdrop) el.drawerBackdrop.hidden = true;
    if (state.lastFocus) focar(state.lastFocus);
  }

  /* ---------------- acesso ao painel de gestão ---------------- */

  var ADMIN_CRED_KEY = "central-acesso-gm.admin.v1";
  var ADMIN_PBKDF2_ITER = 150000;
  var adminAcesso = { modo: "unlock", ocupado: false };

  function bytesParaBase64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ParaBytes(texto) {
    var bin = atob(texto);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function iguaisBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var diferenca = 0;
    for (var i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
    return diferenca === 0;
  }

  function armazenamentoAdminDisponivel() {
    try {
      var teste = "__gm_admin_teste__";
      localStorage.setItem(teste, "1");
      localStorage.removeItem(teste);
      return true;
    } catch (e) {
      return false;
    }
  }

  function lerCredencialAdmin() {
    try {
      var bruto = localStorage.getItem(ADMIN_CRED_KEY);
      if (!bruto) return null;
      var cred = JSON.parse(bruto);
      if (!cred || cred.v !== 1 || typeof cred.salt !== "string" || typeof cred.hash !== "string") {
        return null;
      }
      return cred;
    } catch (e) {
      return null;
    }
  }

  async function derivarSenhaAdmin(senha, salt, iteracoes) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) {
      throw new Error("Este aplicativo não oferece criptografia segura. Atualize o Android ou reinstale o APK.");
    }
    var base = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(senha),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    var bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: salt,
      iterations: iteracoes || ADMIN_PBKDF2_ITER,
      hash: "SHA-256"
    }, base, 256);
    return new Uint8Array(bits);
  }

  async function definirSenhaAdmin(senha) {
    if (!armazenamentoAdminDisponivel()) {
      throw new Error("Este aplicativo não permite salvar a senha de gestão. Verifique o armazenamento do dispositivo.");
    }
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var hash = await derivarSenhaAdmin(senha, salt, ADMIN_PBKDF2_ITER);
    localStorage.setItem(ADMIN_CRED_KEY, JSON.stringify({
      v: 1,
      iter: ADMIN_PBKDF2_ITER,
      salt: bytesParaBase64(salt),
      hash: bytesParaBase64(hash)
    }));
  }

  async function conferirSenhaAdmin(senha) {
    var cred = lerCredencialAdmin();
    if (!cred) return false;
    var iter = Number(cred.iter);
    if (!isFinite(iter) || iter < 10000 || iter > 1000000) iter = ADMIN_PBKDF2_ITER;
    var hash = await derivarSenhaAdmin(senha, base64ParaBytes(cred.salt), iter);
    var confere = iguaisBytes(hash, base64ParaBytes(cred.hash));
    hash.fill(0);
    return confere;
  }

  function atualizarStatusSenhaAdmin() {
    if (!el.adminPasswordStatus) return;
    setText(el.adminPasswordStatus, lerCredencialAdmin()
      ? "Acesso protegido por senha. A senha pode ser alterada abaixo."
      : "Nenhuma senha definida neste navegador. Crie uma para proteger o painel.");
  }

  function mostrarAdmin() {
    if (el.adminDrawer) el.adminDrawer.hidden = false;
    if (el.adminBackdrop) el.adminBackdrop.hidden = false;
    atualizarStatusSenhaAdmin();
    var fechar = $('[data-action="close-admin"]', el.adminDrawer);
    if (fechar) setTimeout(function () { focar(fechar); }, 40);
  }

  function abrirAdmin() {
    state.adminFocus = document.activeElement;
    mostrarAdmin();
  }

  function solicitarAcessoAdmin() {
    state.adminFocus = document.activeElement;
    if (!el.adminPassDrawer) {
      mostrarAdmin();
      return;
    }
    abrirSenhaAdmin(lerCredencialAdmin() ? "unlock" : "setup");
  }

  function fecharAdmin() {
    if (el.adminDrawer) el.adminDrawer.hidden = true;
    if (el.adminBackdrop) el.adminBackdrop.hidden = true;
    var destino = state.adminFocus || state.lastFocus;
    state.adminFocus = null;
    if (destino) focar(destino);
  }

  function abrirSenhaAdmin(modo) {
    if (!el.adminPassDrawer) return;
    if (modo === "change" && !lerCredencialAdmin()) modo = "setup";

    adminAcesso.modo = modo;
    adminAcesso.ocupado = false;
    state.adminPassFocus = document.activeElement;

    clearError(el.adminPassError);
    if (el.adminPassCurrent) el.adminPassCurrent.value = "";
    if (el.adminPassNew) el.adminPassNew.value = "";
    if (el.adminPassConfirm) el.adminPassConfirm.value = "";

    var trocando = modo === "change";
    var criando = modo === "setup";

    setText(el.adminPassTitle, trocando ? "Alterar senha" : (criando ? "Criar senha de acesso" : "Acesso restrito"));
    setText(el.adminPassSub, trocando
      ? "Confirme a senha atual e defina uma nova."
      : (criando ? "Defina a senha que protegerá o painel." : "Digite a senha do painel para continuar."));

    if (el.adminPassCurrentField) el.adminPassCurrentField.hidden = !trocando;
    if (el.adminPassConfirmField) el.adminPassConfirmField.hidden = !trocando && !criando;
    setText(el.adminPassNewLabel, trocando ? "Nova senha" : (criando ? "Nova senha" : "Senha"));
    setText(el.adminPassHint, trocando || criando
      ? "Mínimo de 6 caracteres. Use algo que só o administrador saiba."
      : "Somente o administrador deve conhecer esta senha.");
    setText(el.btnAdminPass, trocando ? "Salvar nova senha" : (criando ? "Criar senha" : "Entrar"));

    el.adminPassDrawer.hidden = false;
    if (el.adminPassBackdrop) el.adminPassBackdrop.hidden = false;

    setTimeout(function () {
      if (trocando && el.adminPassCurrent) focar(el.adminPassCurrent);
      else if (el.adminPassNew) focar(el.adminPassNew);
    }, 40);
  }

  function fecharSenhaAdmin(restaurarFoco) {
    if (!el.adminPassDrawer || el.adminPassDrawer.hidden) return;
    el.adminPassDrawer.hidden = true;
    if (el.adminPassBackdrop) el.adminPassBackdrop.hidden = true;
    if (el.adminPassCurrent) el.adminPassCurrent.value = "";
    if (el.adminPassNew) el.adminPassNew.value = "";
    if (el.adminPassConfirm) el.adminPassConfirm.value = "";
    clearError(el.adminPassError);
    if (restaurarFoco !== false && state.adminPassFocus) focar(state.adminPassFocus);
    state.adminPassFocus = null;
  }

  async function enviarSenhaAdmin() {
    if (!el.adminPassDrawer || el.adminPassDrawer.hidden || adminAcesso.ocupado) return;

    var modo = adminAcesso.modo;
    var nova = el.adminPassNew ? el.adminPassNew.value : "";
    var confirma = el.adminPassConfirm ? el.adminPassConfirm.value : "";
    var atual = el.adminPassCurrent ? el.adminPassCurrent.value : "";
    var rotulo = modo === "unlock" ? "Entrar" : (modo === "setup" ? "Criar senha" : "Salvar nova senha");

    clearError(el.adminPassError);

    if (!nova) {
      showError(el.adminPassError, "Digite a senha.");
      if (el.adminPassNew) focar(el.adminPassNew);
      return;
    }

    if (modo !== "unlock") {
      if (nova.length < 6) {
        showError(el.adminPassError, "A senha deve ter pelo menos 6 caracteres.");
        if (el.adminPassNew) focar(el.adminPassNew);
        return;
      }
      if (nova !== confirma) {
        showError(el.adminPassError, "As senhas não conferem.");
        if (el.adminPassConfirm) { el.adminPassConfirm.value = ""; focar(el.adminPassConfirm); }
        return;
      }
    }

    adminAcesso.ocupado = true;
    ocuparBotao(el.btnAdminPass, true, "Verificando…");

    try {
      if (modo === "unlock") {
        var valida = await conferirSenhaAdmin(nova);
        if (!valida) {
          showError(el.adminPassError, "Senha incorreta. Tente novamente.");
          if (el.adminPassNew) { el.adminPassNew.value = ""; focar(el.adminPassNew); }
          return;
        }
        fecharSenhaAdmin(false);
        mostrarAdmin();
        toast("Acesso liberado.");
        return;
      }

      if (modo === "change") {
        var atualValida = await conferirSenhaAdmin(atual);
        if (!atualValida) {
          showError(el.adminPassError, "A senha atual está incorreta.");
          if (el.adminPassCurrent) { el.adminPassCurrent.value = ""; focar(el.adminPassCurrent); }
          return;
        }
      }

      await definirSenhaAdmin(nova);

      if (modo === "setup") {
        fecharSenhaAdmin(false);
        mostrarAdmin();
        toast("Senha criada. Guarde-a em local seguro.");
      } else {
        fecharSenhaAdmin();
        toast("Senha de acesso atualizada.");
      }
    } catch (e) {
      showError(el.adminPassError, "Não foi possível salvar a senha: " +
        (e && e.message ? e.message : "falha inesperada") + ".");
    } finally {
      adminAcesso.ocupado = false;
      ocuparBotao(el.btnAdminPass, false, rotulo);
    }
  }

  function exportarLog() {
    if (!state.log.length) { toast("Nenhuma operação para exportar."); return; }

    var linhas = [
      "REGISTRO DE OPERACOES - Central de Acesso GM",
      "Gerado em " + formatarData(new Date()),
      "Sem senhas e sem CPF completo (LGPD).",
      "------------------------------------------------------------"
    ];

    state.log.slice().reverse().forEach(function (item) {
      linhas.push(formatarData(item.quando) + " | CPF " + item.cpf + " | " +
        item.opcao + " | " + item.status.toUpperCase() + " | " + item.protocolo);
    });

    var blob = new Blob([linhas.join("\r\n")], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "registro-operacoes-" + new Date().toISOString().slice(0, 10) + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast("Arquivo de registro exportado.");
  }

  function limparLog() {
    state.log = [];
    atualizarLogUi();
    toast("Registro desta sessão apagado.");
  }

  /* ---------------- impressora (configuração local) ---------------- */

  var printServer = {
    online: false,
    verificado: false,
    padrao: "",
    impressoras: [],
    papeis: []
  };

  function configImpressaoAtual() {
    var cfg = CFG.impressao || {};
    var dims = dimensoesDaConfig();
    return {
      modo: cfg.modo === "direto" ? "direto" : "navegador",
      impressora: cfg.impressora || "",
      papelPadrao: dims.papel,
      papelNome: dims.papelNome || "",
      larguraMm: dims.larguraMm,
      alturaMm: dims.alturaMm
    };
  }

  function definirStatusImpressora(estado, texto) {
    if (el.settingsStatus) el.settingsStatus.setAttribute("data-state", estado);
    setText(el.settingsStatusText, texto);
  }

  function preencherImpressoras(selecionada) {
    var sel = el.settingsPrinter;
    if (!sel) return;

    var atual = selecionada != null ? selecionada : (sel.value || "");
    sel.innerHTML = "";

    var padrao = document.createElement("option");
    padrao.value = "";
    padrao.textContent = printServer.padrao
      ? "Rede — " + printServer.padrao
      : "Impressora de rede configurada";
    sel.appendChild(padrao);

    var nomes = printServer.impressoras.slice();
    if (atual && nomes.indexOf(atual) < 0) nomes.push(atual);

    nomes.forEach(function (nome) {
      var opt = document.createElement("option");
      var ausente = printServer.online && printServer.impressoras.indexOf(nome) < 0;
      opt.value = nome;
      opt.textContent = (atual === nome && ausente)
        ? nome + " (não encontrada)"
        : nome;
      sel.appendChild(opt);
    });

    sel.value = atual;
    if (sel.value !== atual) sel.value = "";
  }

  function atualizarNotaImpressora() {
    if (!el.settingsNote) return;

    var nome = el.settingsPrinter ? el.settingsPrinter.value : "";
    var direct = el.settingsMode && el.settingsMode.value === "direto";
    var msg = "";

    if (nome && printServer.impressoras.length && printServer.impressoras.indexOf(nome) < 0) {
      msg = "A impressora \"" + nome + "\" não respondeu na rede. Confira o IP e a porta.";
    } else if (direct) {
      msg = "O comprovante sairá direto em: " + (nome || printServer.padrao || "impressora configurada") + ".";
    }

    setText(el.settingsNote, msg);
    el.settingsNote.hidden = !msg;
  }

  function atualizarDicaModo() {
    var direct = el.settingsMode && el.settingsMode.value === "direto";

    if (el.settingsModeHint) {
      setText(el.settingsModeHint, direct
        ? "Envia direto para a impressora de rede configurada."
        : "Abre a janela de impressão para você escolher a impressora e confirmar.");
    }
    if (el.btnTestPrint) el.btnTestPrint.disabled = !printServer.online;
    atualizarNotaImpressora();
  }

  function preencherConfigImpressao(cfg) {
    if (el.settingsMode) el.settingsMode.value = cfg.modo;
    preencherOpcoesPapel(el.settingsPaper, opcaoPapelDe(cfg));

    var largura = medidaMm(cfg.larguraMm, 20, 300);
    var altura = medidaMm(cfg.alturaMm, 20, 1000);
    if (largura !== null) papelLivreConfig.larguraMm = largura;
    if (altura !== null) papelLivreConfig.alturaMm = altura;

    if (el.settingsPaperW) el.settingsPaperW.value = papelLivreConfig.larguraMm;
    if (el.settingsPaperH) el.settingsPaperH.value = papelLivreConfig.alturaMm;

    ultimaOpcaoPapelConfig = el.settingsPaper ? el.settingsPaper.value : "personalizado";
    atualizarCamposPapelConfig();

    preencherImpressoras(cfg.impressora);
    atualizarDicaModo();
  }

  function ocuparBotao(node, ocupado, rotulo) {
    if (!node) return;
    node.disabled = ocupado;
    if (rotulo) node.textContent = rotulo;
  }

  async function carregarImpressoras() {
    try {
      var resp = await fetch("impressoras", { headers: { "Accept": "application/json" } });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var dados = await resp.json();
      if (!dados || dados.ok !== true) throw new Error("resposta inválida");

      printServer.online = true;
      printServer.padrao = typeof dados.padrao === "string" ? dados.padrao : "";
      printServer.impressoras = Array.isArray(dados.impressoras) ? dados.impressoras : [];

      definirStatusImpressora("ok", "Impressora de rede" +
        (printServer.padrao ? " · padrão: " + printServer.padrao : "") + ".");
      preencherImpressoras(configImpressaoAtual().impressora);
      await carregarPapeis(configImpressaoAtual().impressora);
      return true;
    } catch (e) {
      printServer.online = false;
      definirStatusImpressora("off", "Impressora de rede não configurada. Informe o IP em Gestão → Impressora.");
      preencherImpressoras(configImpressaoAtual().impressora);
      return false;
    } finally {
      printServer.verificado = true;
      atualizarDicaModo();
    }
  }

  /* Formulários de papel instalados no driver (evitam o comprovante cortado). */
  async function carregarPapeis(impressora) {
    var url = "papeis" + (impressora ? "?impressora=" + encodeURIComponent(impressora) : "");
    try {
      var resp = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var dados = await resp.json();
      if (!dados || dados.ok !== true) throw new Error("resposta inválida");

      printServer.papeis = Array.isArray(dados.papeis) ? dados.papeis : [];
    } catch (e) {
      printServer.papeis = [];
    }

    preencherOpcoesPapel(el.settingsPaper, el.settingsPaper ? el.settingsPaper.value : "");
    atualizarCamposPapelConfig();
  }

  async function carregarConfigImpressao() {
    try {
      var resp = await fetch("config-impressao", { headers: { "Accept": "application/json" } });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var dados = await resp.json();
      if (!dados || dados.ok !== true || !dados.config) return;

      var cfg = dados.config;
      CFG.impressao = CFG.impressao || {};
      if (cfg.modo === "direto" || cfg.modo === "navegador") CFG.impressao.modo = cfg.modo;
      if (typeof cfg.impressora === "string") CFG.impressao.impressora = cfg.impressora;
      if (papelValido(cfg.papelPadrao)) CFG.impressao.papelPadrao = cfg.papelPadrao;
      CFG.impressao.papelNome = typeof cfg.papelNome === "string" ? cfg.papelNome : "";
      var largura = medidaMm(cfg.larguraMm, 20, 300);
      var altura = medidaMm(cfg.alturaMm, 20, 1000);
      if (largura !== null) CFG.impressao.larguraMm = largura;
      if (altura !== null) CFG.impressao.alturaMm = altura;

      aplicarConfig();
    } catch (e) {
      /* Servidor desligado: mantém o que está em assets/config.js. */
    }
  }

  function abrirConfigImpressao() {
    state.lastFocus = document.activeElement;
    if (!el.settings) return;

    clearError(el.settingsError);
    preencherConfigImpressao(configImpressaoAtual());
    el.settings.hidden = false;
    if (el.settingsBackdrop) el.settingsBackdrop.hidden = false;

    carregarImpressoras().then(function () {
      if (!el.settings || el.settings.hidden) return;
      preencherImpressoras(configImpressaoAtual().impressora);
      atualizarDicaModo();
    });

    var fechar = $('[data-action="close-settings"]', el.settings);
    if (fechar) setTimeout(function () { focar(fechar); }, 40);
  }

  function fecharConfigImpressao() {
    if (el.settings) el.settings.hidden = true;
    if (el.settingsBackdrop) el.settingsBackdrop.hidden = true;
    if (state.lastFocus) focar(state.lastFocus);
  }

  async function salvarConfigImpressao() {
    var opcao = el.settingsPaper ? el.settingsPaper.value : "personalizado";
    var det = detalhesPapel(
      opcao,
      el.settingsPaperW ? el.settingsPaperW.value : 72,
      el.settingsPaperH ? el.settingsPaperH.value : 297
    );

    if (det.opcao === "personalizado") {
      var larguraOk = medidaMm(det.larguraMm, 20, 300);
      var alturaOk = medidaMm(det.alturaMm, 20, 1000);
      if (larguraOk === null) {
        showError(el.settingsError, "A largura da etiqueta deve ficar entre 20 e 300 mm.");
        return;
      }
      if (alturaOk === null) {
        showError(el.settingsError, "A altura da etiqueta deve ficar entre 20 e 1000 mm.");
        return;
      }
      det.larguraMm = larguraOk;
      det.alturaMm = alturaOk;
    }

    var cfg = {
      modo: el.settingsMode ? el.settingsMode.value : "navegador",
      impressora: el.settingsPrinter ? el.settingsPrinter.value : "",
      papelPadrao: det.papel,
      papelNome: det.papelNome,
      larguraMm: det.larguraMm,
      alturaMm: det.alturaMm
    };

    clearError(el.settingsError);
    ocuparBotao(el.btnSaveSettings, true, "Salvando…");

    try {
      var resp = await fetch("config-impressao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg)
      });

      var dados = null;
      try { dados = await resp.json(); } catch (e) { dados = null; }

      if (!resp.ok || !dados || dados.ok !== true) {
        throw new Error((dados && dados.erro) || ("HTTP " + resp.status));
      }

      var salvo = (dados.config && typeof dados.config === "object") ? dados.config : cfg;

      CFG.impressao = CFG.impressao || {};
      CFG.impressao.modo = salvo.modo === "direto" ? "direto" : "navegador";
      CFG.impressao.impressora = typeof salvo.impressora === "string" ? salvo.impressora : "";
      CFG.impressao.papelPadrao = papelValido(salvo.papelPadrao) ? salvo.papelPadrao : "personalizado";
      CFG.impressao.papelNome = typeof salvo.papelNome === "string" ? salvo.papelNome : "";
      var larguraSalva = medidaMm(salvo.larguraMm, 20, 300);
      var alturaSalva = medidaMm(salvo.alturaMm, 20, 1000);
      CFG.impressao.larguraMm = larguraSalva !== null ? larguraSalva : 72;
      CFG.impressao.alturaMm = alturaSalva !== null ? alturaSalva : 297;

      aplicarConfig();
      preencherConfigImpressao(configImpressaoAtual());
      toast("Configuração de impressão salva.");
    } catch (e) {
      showError(el.settingsError, "Não foi possível salvar: " +
        (e && e.message ? e.message : "falha de comunicação") + ".");
    } finally {
      ocuparBotao(el.btnSaveSettings, false, "Salvar");
    }
  }

  async function testarImpressora() {
    if (!printServer.online) {
      showError(el.settingsError, "Impressora de rede indisponível. Confira IP, porta e protocolo em Gestão → Impressora.");
      return;
    }

    var opcaoTeste = el.settingsPaper ? el.settingsPaper.value : "personalizado";
    var detTeste = detalhesPapel(
      opcaoTeste,
      el.settingsPaperW ? el.settingsPaperW.value : 72,
      el.settingsPaperH ? el.settingsPaperH.value : 297
    );

    if (detTeste.opcao === "personalizado") {
      var larguraOk = medidaMm(detTeste.larguraMm, 20, 300);
      var alturaOk = medidaMm(detTeste.alturaMm, 20, 1000);
      if (larguraOk === null || alturaOk === null) {
        showError(el.settingsError, "Informe a largura (20 a 300 mm) e a altura (20 a 1000 mm) da etiqueta.");
        return;
      }
      detTeste.larguraMm = larguraOk;
      detTeste.alturaMm = alturaOk;
    }

    var limite = Math.max(3000, Number((CFG.impressao || {}).tempoLimiteMs) || 15000);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, limite);

    clearError(el.settingsError);
    ocuparBotao(el.btnTestPrint, true, "Enviando…");

    try {
      var resp = await fetch("imprimir/teste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          impressora: el.settingsPrinter ? el.settingsPrinter.value : "",
          papel: detTeste.papel,
          papelNome: detTeste.papelNome,
          larguraMm: detTeste.larguraMm,
          alturaMm: detTeste.alturaMm
        }),
        signal: ctrl ? ctrl.signal : undefined
      });

      var dados = null;
      try { dados = await resp.json(); } catch (e) { dados = null; }

      if (!resp.ok || !dados || dados.ok !== true) {
        throw new Error((dados && dados.erro) || ("HTTP " + resp.status));
      }

      toast(dados.simulado
        ? "Modo de teste: impressão validada, nenhum papel foi gasto."
        : "Teste enviado para " + (dados.impressora || "a impressora") + ".");
    } catch (e) {
      var motivo = (e && e.name === "AbortError") ? "tempo esgotado" :
        (e && e.message ? e.message : "falha de comunicação");
      showError(el.settingsError, "Não foi possível testar: " + motivo + ".");
    } finally {
      clearTimeout(timer);
      ocuparBotao(el.btnTestPrint, false, "Testar impressora");
      if (el.btnTestPrint) el.btnTestPrint.disabled = !printServer.online;
    }
  }

  /* ---------------- marca do sistema ---------------- */

  /* Aplica a marca (config.js -> sistema.marca) em todo o sistema:
     cabeçalho, rodapé, tela de descanso e comprovante impresso.
     A palavra em 3D entra letra por letra. */
  function aplicarMarca() {
    var sistema = CFG.sistema || {};
    var marca = sistema.marca || {};
    var raiz = document.documentElement;

    if (marca.cor) raiz.style.setProperty("--marca", marca.cor);
    if (marca.corEscura) raiz.style.setProperty("--marca-escura", marca.corEscura);

    [
      ["[data-marca]", marca.palavra],
      ["[data-unidade]", marca.unidade],
      ["[data-assinatura]", marca.assinatura]
    ].forEach(function (par) {
      if (!par[1]) return;
      document.querySelectorAll(par[0]).forEach(function (no) { no.textContent = par[1]; });
    });

    document.querySelectorAll("[data-marca-3d]").forEach(function (no) {
      no.textContent = "";
      if (!marca.palavra) return;
      marca.palavra.split("").forEach(function (ch, i) {
        var letra = document.createElement("span");
        letra.className = "ss-ch";
        letra.style.setProperty("--i", i);
        letra.textContent = ch === " " ? "\u00A0" : ch;
        no.appendChild(letra);
      });
    });

    if (marca.palavra && sistema.nome) {
      document.title = marca.palavra + " · " + sistema.nome;
    }
  }

  /* ---------------- descanso de tela ---------------- */

  function reiniciarDescanso() {
    if (state.descansoVisivel || state.descansoAposImpressao) return;
    clearTimeout(state.descansoTimer);
    var segundos = Number((CFG.descanso || {}).segundos) || 90;
    state.descansoTimer = setTimeout(mostrarDescanso, Math.max(10, segundos) * 1000);
  }

  /* Depois que o comprovante sai, o atendimento tem um prazo curto
     (30 segundos por padrao) para a via ser conferida. Passado esse
     prazo, o descanso volta sozinho e a sessao e apagada. */
  function agendarDescansoAposImpressao() {
    clearTimeout(state.descansoTimer);
    state.descansoAposImpressao = true;
    var segundos = Number((CFG.descanso || {}).aposImpressaoSegundos);
    if (!isFinite(segundos) || segundos <= 0) segundos = 30;
    state.descansoTimer = setTimeout(mostrarDescanso, Math.max(5, segundos) * 1000);
  }

  function cancelarDescansoAposImpressao() {
    if (!state.descansoAposImpressao) return;
    state.descansoAposImpressao = false;
    reiniciarDescanso();
  }

  function mostrarDescanso() {
    clearTimeout(state.descansoTimer);
    if (state.descansoVisivel) return;

    if (state.running) {
      state.descansoTimer = setTimeout(mostrarDescanso, 15000);
      return;
    }

    var aposImpressao = state.descansoAposImpressao;
    state.descansoAposImpressao = false;

    if (el.adminPassDrawer && !el.adminPassDrawer.hidden) fecharSenhaAdmin(false);
    if (el.settings && !el.settings.hidden) fecharConfigImpressao();
    if (el.drawer && !el.drawer.hidden) fecharLog();
    if (el.adminDrawer && !el.adminDrawer.hidden) fecharAdmin();

    if (state.colaborador || state.opcao || state.gmId || state.senhaBox) {
      limparTudo();
      state.descansoAviso = aposImpressao
        ? "Atendimento finalizado. Todos os dados foram apagados."
        : "Atendimento encerrado por inatividade. Todos os dados foram apagados.";
    }

    state.descansoVisivel = true;
    if (el.screensaver) el.screensaver.hidden = false;
    document.body.classList.add("is-resting");
    setTimeout(function () { focar(el.ssWake); }, 60);
  }

  function acordarDescanso() {
    if (!state.descansoVisivel) return;
    state.descansoVisivel = false;
    if (el.screensaver) el.screensaver.hidden = true;
    document.body.classList.remove("is-resting");
    reiniciarDescanso();
    if (state.descansoAviso) {
      toast(state.descansoAviso);
      state.descansoAviso = "";
    }
    setTimeout(function () { focar(el.homeTitle); }, 60);
  }

  /* ---------------- eventos ---------------- */

  function bind() {
    if (el.options) {
      el.options.addEventListener("click", function (ev) {
        var btn = ev.target.closest(".option");
        if (!btn || btn.disabled) return;
        abrirOpcao(btn.getAttribute("data-option"));
      });
    }

    if (el.serviceForm) el.serviceForm.addEventListener("submit", executar);

    if (el.screensaver) el.screensaver.addEventListener("click", acordarDescanso);

    document.addEventListener("click", function (ev) {
      var toggle = ev.target.closest("[data-toggle]");
      if (toggle) { alternarCampo(toggle); return; }

      var alvo = ev.target.closest("[data-action]");
      if (!alvo) return;

      var acao = alvo.getAttribute("data-action");
      if (acao === "home" || acao === "back-home") ev.preventDefault();

      switch (acao) {
        case "home":
        case "back-home": voltarInicio(); break;
        case "new-operation": encerrar("Pronto para um novo atendimento. Os dados foram apagados."); break;
        case "end": encerrar("Atendimento encerrado. Os dados foram apagados."); break;
        case "open-admin": solicitarAcessoAdmin(); break;
        case "close-admin": fecharAdmin(); break;
        case "change-admin-pass": abrirSenhaAdmin("change"); break;
        case "close-admin-pass": fecharSenhaAdmin(); break;
        case "submit-admin-pass": enviarSenhaAdmin(); break;
        case "open-log": abrirLog(); break;
        case "close-log": fecharLog(); break;
        case "export-log": exportarLog(); break;
        case "clear-log": limparLog(); break;
        case "open-settings": abrirConfigImpressao(); break;
        case "close-settings": fecharConfigImpressao(); break;
        case "save-settings": salvarConfigImpressao(); break;
        case "test-print": testarImpressora(); break;
        case "copy-gm":
          if (state.gmId) copiar(state.gmId, "GM ID copiado.");
          break;
        case "reveal-pass": alternarSenha(); break;
        case "print": imprimir(); break;
      }
    });

    if (el.drawerBackdrop) el.drawerBackdrop.addEventListener("click", fecharLog);
    if (el.settingsBackdrop) el.settingsBackdrop.addEventListener("click", fecharConfigImpressao);
    if (el.adminBackdrop) el.adminBackdrop.addEventListener("click", fecharAdmin);
    if (el.adminPassBackdrop) el.adminPassBackdrop.addEventListener("click", function () { fecharSenhaAdmin(); });

    [el.adminPassCurrent, el.adminPassNew, el.adminPassConfirm].forEach(function (campo) {
      if (!campo) return;
      campo.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          enviarSenhaAdmin();
        }
      });
    });
    if (el.settingsMode) el.settingsMode.addEventListener("change", atualizarDicaModo);
    if (el.settingsPrinter) el.settingsPrinter.addEventListener("change", function () {
      atualizarNotaImpressora();
      carregarPapeis(el.settingsPrinter.value);
    });
    if (el.settingsPaper) el.settingsPaper.addEventListener("change", atualizarCamposPapelConfig);

    document.addEventListener("keydown", function (ev) {
      if (state.descansoVisivel) {
        ev.preventDefault();
        acordarDescanso();
        return;
      }
      if (ev.key === "Escape") {
        if (el.adminPassDrawer && !el.adminPassDrawer.hidden) fecharSenhaAdmin();
        else if (el.settings && !el.settings.hidden) fecharConfigImpressao();
        else if (el.drawer && !el.drawer.hidden) fecharLog();
        else if (el.adminDrawer && !el.adminDrawer.hidden) fecharAdmin();
      }
    });

    window.addEventListener("afterprint", function () {
      if (state.view !== "service") return;
      if (state.senhaBox) finalizarImpressao();
      if (state.gmId) agendarDescansoAposImpressao();
    });

    var ultimaAtividade = 0;
    function atividade() {
      var agora = Date.now();
      if (agora - ultimaAtividade < 1000) return;
      ultimaAtividade = agora;
      reiniciarDescanso();
    }

    ["pointerdown", "keydown", "touchstart", "pointermove"].forEach(function (evt) {
      document.addEventListener(evt, atividade, { passive: true });
    });
  }

  /* ---------------- arranque ---------------- */

  function init() {
    cacheEls();

    if (!window.GMAdapter) {
      toast("Falha ao carregar o adaptador de automação.");
      return;
    }

    aplicarConfig();
    aplicarMarca();
    bind();
    atualizarLogUi();

    carregarConfigImpressao().then(carregarImpressoras).then(function () {
      if (el.settings && el.settings.hidden) preencherConfigImpressao(configImpressaoAtual());
    });

    if (CFG.descanso && CFG.descanso.aoAbrir !== false) {
      mostrarDescanso();
    } else {
      reiniciarDescanso();
    }
  }

  init();
})();