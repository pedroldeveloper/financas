import { ADMIN_EMAIL, auth, db } from "./firebase.js";
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const STATUS_LABEL = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  deactivated: "Desativado"
};

const COLLECTIONS = {
  users: "users",
  transactions: "transactions",
  deletedAccounts: "deleted_accounts"
};

const LIMITE_CENTAVOS = 99_999_999_999_999;
const LIMITE_VALOR = LIMITE_CENTAVOS / 100;
const ADMIN_EMAIL_NORMALIZADO = ADMIN_EMAIL.trim().toLowerCase();
const textosOriginaisBotoes = new WeakMap();

const elementos = {
  telaAuth: document.getElementById("tela-auth"),
  telaApp: document.getElementById("tela-app"),
  mensagemAuth: document.getElementById("mensagem-auth"),
  mensagemApp: document.getElementById("mensagem-app"),
  mensagemPerfil: document.getElementById("mensagem-perfil"),
  rotuloAuth: document.getElementById("rotulo-auth"),
  tituloAuth: document.getElementById("titulo-auth"),
  textoAuth: document.getElementById("texto-auth"),
  botaoModoLogin: document.getElementById("botao-modo-login"),
  botaoModoRegistro: document.getElementById("botao-modo-registro"),
  formAuth: document.getElementById("form-auth"),
  formTransacao: document.getElementById("form-transacao"),
  formPerfil: document.getElementById("form-perfil"),
  campoLoginEmail: document.getElementById("login-email"),
  campoLoginSenha: document.getElementById("login-senha"),
  botaoSubmitAuth: document.getElementById("botao-submit-auth"),
  botaoLogout: document.getElementById("botao-logout"),
  botaoEditarPerfil: document.getElementById("botao-editar-perfil"),
  botaoExcluirMinhaConta: document.getElementById("botao-excluir-minha-conta"),
  botaoCancelarPerfil: document.getElementById("botao-cancelar-perfil"),
  tituloUsuario: document.getElementById("titulo-usuario"),
  subtituloUsuario: document.getElementById("subtitulo-usuario"),
  saldoAtual: document.getElementById("saldo-atual"),
  totalEntradas: document.getElementById("total-entradas"),
  totalSaidas: document.getElementById("total-saidas"),
  listaTransacoes: document.getElementById("lista-transacoes"),
  secaoAdmin: document.getElementById("secao-admin"),
  listaUsuariosAdmin: document.getElementById("lista-usuarios-admin"),
  transacaoData: document.getElementById("transacao-data"),
  transacaoValor: document.getElementById("transacao-valor"),
  modalPerfil: document.getElementById("modal-perfil"),
  modalFundoPerfil: document.querySelector("#modal-perfil .modal-fundo"),
  tituloModalPerfil: document.getElementById("titulo-modal-perfil"),
  textoModalPerfil: document.getElementById("texto-modal-perfil"),
  campoUsername: document.getElementById("perfil-username")
};

let usuarioAtual = null;
let perfilAtual = null;
let limpezaEscutaTransacoes = null;
let limpezaEscutaUsuarios = null;
let limpezaEscutaStatus = null;
let modoPerfilObrigatorio = false;
let exclusaoContaAtualEmAndamento = false;
let modoAuthAtual = "login";
let cadastroEmAndamento = false;

function registrarErroSeguranca(contexto, erro) {
  const codigo = erro?.code || "sem-codigo";
  const mensagem = erro?.message ? String(erro.message) : "sem-detalhes";
  console.error(`[${contexto}]`, `${codigo}: ${mensagem}`);
}

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function ehAdminEmail(email) {
  return normalizarEmail(email) === ADMIN_EMAIL_NORMALIZADO;
}

function usuarioAutenticado() {
  return auth.currentUser && usuarioAtual && auth.currentUser.uid === usuarioAtual.uid;
}

function podeAdministrar() {
  return usuarioAutenticado() && ehAdminEmail(usuarioAtual.email);
}

function exibirMensagem(elemento, texto, tipo) {
  if (!elemento) {
    return;
  }

  elemento.textContent = texto;
  elemento.className = `mensagem ${tipo}`;
}

function ocultarMensagem(elemento) {
  if (!elemento) {
    return;
  }

  elemento.textContent = "";
  elemento.className = "mensagem oculto";
}

function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (caractere) => {
    const mapa = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };

    return mapa[caractere] || caractere;
  });
}

function definirEstadoBotao(botao, carregando, textoCarregando = "Processando...") {
  if (!botao) {
    return;
  }

  if (!textosOriginaisBotoes.has(botao)) {
    textosOriginaisBotoes.set(botao, botao.textContent);
  }

  botao.disabled = carregando;
  botao.setAttribute("aria-busy", carregando ? "true" : "false");
  botao.textContent = carregando ? textoCarregando : textosOriginaisBotoes.get(botao);
}

async function executarComEstadoDeCarregamento(botao, textoCarregando, operacao) {
  if (botao?.disabled) {
    return;
  }

  definirEstadoBotao(botao, true, textoCarregando);

  try {
    return await operacao();
  } finally {
    definirEstadoBotao(botao, false);
  }
}

function obterDataHojeIso() {
  const agora = new Date();
  const fusoLocalMs = agora.getTimezoneOffset() * 60_000;
  return new Date(agora.getTime() - fusoLocalMs).toISOString().slice(0, 10);
}

function definirDataPadrao() {
  elementos.transacaoData.value = obterDataHojeIso();
}

function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(valor) || 0);
}

function formatarData(dataString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataString)) {
    return "Data inválida";
  }

  const data = new Date(`${dataString}T12:00:00`);
  if (Number.isNaN(data.getTime())) {
    return "Data inválida";
  }

  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarDataIso(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return false;
  }

  const dataConvertida = new Date(`${data}T12:00:00`);
  return !Number.isNaN(dataConvertida.getTime()) && dataConvertida.toISOString().startsWith(data);
}

function limparEscutas() {
  if (limpezaEscutaTransacoes) {
    limpezaEscutaTransacoes();
    limpezaEscutaTransacoes = null;
  }

  if (limpezaEscutaUsuarios) {
    limpezaEscutaUsuarios();
    limpezaEscutaUsuarios = null;
  }

  if (limpezaEscutaStatus) {
    limpezaEscutaStatus();
    limpezaEscutaStatus = null;
  }
}

function normalizarCampoMoeda(campo) {
  const somenteDigitos = campo.value.replace(/\D/g, "").slice(0, 14);

  if (!somenteDigitos) {
    campo.value = "";
    campo.dataset.valorNumerico = "";
    return;
  }

  const centavos = Math.min(Number(somenteDigitos), LIMITE_CENTAVOS);
  const valor = centavos / 100;
  campo.dataset.valorNumerico = String(valor);
  campo.value = formatarMoeda(valor);
}

function obterValorMonetarioDoCampo(campo) {
  const valor = Number(campo.dataset.valorNumerico || "0");
  return Number.isFinite(valor) ? valor : 0;
}

function limparEmailParaExibicao(email) {
  const valor = normalizarEmail(email);
  if (!valor.includes("@")) {
    return valor;
  }

  const [usuario, dominio] = valor.split("@");
  if (usuario.length <= 2) {
    return `${usuario[0] || "*"}***@${dominio}`;
  }

  return `${usuario.slice(0, 2)}***@${dominio}`;
}

function resetarResumoFinanceiro() {
  elementos.saldoAtual.textContent = formatarMoeda(0);
  elementos.totalEntradas.textContent = formatarMoeda(0);
  elementos.totalSaidas.textContent = formatarMoeda(0);
  elementos.listaTransacoes.innerHTML = `
    <div class="transacao-vazia">
      <p>Nenhuma transação foi registrada até o momento.</p>
    </div>
  `;
}

function resetarPainelAdmin() {
  elementos.listaUsuariosAdmin.innerHTML = "";
  elementos.secaoAdmin.classList.add("oculto");
}

function resetarFormularioTransacao() {
  elementos.formTransacao.reset();
  elementos.transacaoValor.dataset.valorNumerico = "";
  definirDataPadrao();
}

function mostrarTelaAuth() {
  usuarioAtual = null;
  perfilAtual = null;
  exclusaoContaAtualEmAndamento = false;
  limparEscutas();
  fecharModalPerfil();
  atualizarVisibilidadeAcoesDoTopo();
  resetarResumoFinanceiro();
  resetarPainelAdmin();
  resetarFormularioTransacao();
  ocultarMensagem(elementos.mensagemApp);
  elementos.telaApp.classList.add("oculto");
  elementos.telaAuth.classList.remove("oculto");
}

function mostrarTelaApp() {
  ocultarMensagem(elementos.mensagemAuth);
  elementos.telaAuth.classList.add("oculto");
  elementos.telaApp.classList.remove("oculto");
}

function traduzirErroAuth(codigo) {
  const mapa = {
    "auth/email-already-in-use": "Este e-mail já está em uso.",
    "auth/invalid-email": "O e-mail informado é inválido.",
    "auth/missing-email": "Informe um e-mail válido para continuar.",
    "auth/weak-password": "A senha é muito fraca. Use no mínimo 6 caracteres.",
    "auth/user-not-found": "Não foi localizada uma conta com este e-mail.",
    "auth/wrong-password": "A senha informada está incorreta.",
    "auth/invalid-login-credentials": "E-mail ou senha inválidos.",
    "auth/network-request-failed": "Falha de conexão. Verifique sua internet e tente novamente.",
    "auth/too-many-requests": "Foram detectadas muitas tentativas. Aguarde alguns minutos e tente novamente.",
    "auth/requires-recent-login": "Entre novamente e repita a ação para confirmar sua identidade."
  };

  return mapa[codigo] || "Ocorreu um erro inesperado. Verifique a configuração do serviço.";
}

function atualizarInterfaceAuth() {
  const emModoLogin = modoAuthAtual === "login";

  elementos.rotuloAuth.textContent = emModoLogin ? "Entrar" : "Criar conta";
  elementos.tituloAuth.textContent = emModoLogin ? "Acesse sua conta" : "Crie sua conta";
  elementos.textoAuth.textContent = emModoLogin
    ? "Informe seu e-mail e sua senha para continuar."
    : "Preencha os dados abaixo para solicitar acesso ao sistema.";
  elementos.botaoSubmitAuth.textContent = emModoLogin ? "Entrar" : "Criar conta";
  elementos.campoLoginSenha.placeholder = emModoLogin ? "Digite sua senha" : "Crie uma senha";
  elementos.botaoModoLogin.classList.toggle("ativo", emModoLogin);
  elementos.botaoModoRegistro.classList.toggle("ativo", !emModoLogin);
  elementos.botaoModoLogin.setAttribute("aria-pressed", emModoLogin ? "true" : "false");
  elementos.botaoModoRegistro.setAttribute("aria-pressed", emModoLogin ? "false" : "true");
}

function definirModoAuth(modo) {
  if (!["login", "registro"].includes(modo) || modoAuthAtual === modo) {
    return;
  }

  modoAuthAtual = modo;
  ocultarMensagem(elementos.mensagemAuth);
  elementos.formAuth.reset();
  atualizarInterfaceAuth();
}

function traduzirErroFirestore(erro, padrao) {
  registrarErroSeguranca("firestore", erro);

  if (!erro?.code) {
    return padrao;
  }

  if (erro.code === "permission-denied") {
    if (ehAdminEmail(auth.currentUser?.email || usuarioAtual?.email)) {
      return `Permissão negada pelo Firestore. Publique as regras do README e confirme se o e-mail de admin nas regras é exatamente ${ADMIN_EMAIL}.`;
    }

    return "Permissão negada pelo Firestore. Verifique as regras do projeto.";
  }

  const mapa = {
    unavailable: "Serviço indisponível no momento. Tente novamente em instantes.",
    unauthenticated: "Sessão inválida. Entre novamente para continuar.",
    "not-found": "Registro não encontrado.",
    cancelled: "Operação cancelada."
  };

  return mapa[erro.code] || `${padrao} (${erro.code})`;
}

function validarUsername(username) {
  const limpo = String(username || "").trim().replace(/\s+/g, " ");

  if (!limpo) {
    return "Informe um nome de usuário.";
  }

  if (limpo.length < 3) {
    return "O nome de usuário deve conter pelo menos 3 caracteres.";
  }

  if (limpo.length > 30) {
    return "O nome de usuário deve conter no máximo 30 caracteres.";
  }

  if (!/^[\p{L}\p{N}._\-\s]+$/u.test(limpo)) {
    return "Use apenas letras, números, espaços, ponto, hífen ou sublinhado.";
  }

  return "";
}

function abrirModalPerfil(obrigatorio, usernameAtual = "") {
  modoPerfilObrigatorio = obrigatorio;
  elementos.tituloModalPerfil.textContent = obrigatorio ? "Definir nome de usuário" : "Editar nome de usuário";
  elementos.textoModalPerfil.textContent = obrigatorio
    ? "Antes de continuar, defina o nome que será exibido no sistema."
    : "Atualize o nome exibido no cabeçalho e nas áreas do sistema.";
  elementos.campoUsername.value = usernameAtual;
  ocultarMensagem(elementos.mensagemPerfil);
  elementos.modalPerfil.classList.remove("oculto");
  elementos.modalPerfil.setAttribute("aria-hidden", "false");
  elementos.botaoCancelarPerfil.classList.toggle("oculto", obrigatorio);
  window.setTimeout(() => elementos.campoUsername.focus(), 50);
}

function fecharModalPerfil() {
  elementos.modalPerfil.classList.add("oculto");
  elementos.modalPerfil.setAttribute("aria-hidden", "true");
  modoPerfilObrigatorio = false;
}

function obterNomeExibicao(perfil, user) {
  if (perfil?.username && perfil.username.trim()) {
    return perfil.username.trim();
  }

  return limparEmailParaExibicao(user.email);
}

function atualizarCabecalho() {
  if (!usuarioAtual) {
    return;
  }

  const nomeExibicao = obterNomeExibicao(perfilAtual, usuarioAtual);
  elementos.tituloUsuario.textContent = `Olá, ${nomeExibicao}`;
  elementos.subtituloUsuario.textContent = `Conta vinculada ao e-mail ${limparEmailParaExibicao(usuarioAtual.email)}.`;
}

function atualizarVisibilidadeAcoesDoTopo() {
  if (!usuarioAtual) {
    elementos.botaoExcluirMinhaConta.classList.remove("oculto");
    return;
  }

  elementos.botaoExcluirMinhaConta.classList.toggle("oculto", ehAdminEmail(usuarioAtual.email));
}

async function obterMarcadorExclusao(uid) {
  const referencia = doc(db, COLLECTIONS.deletedAccounts, uid);
  const snapshot = await getDoc(referencia);
  return snapshot.exists() ? snapshot.data() : null;
}

async function garantirDocumentoUsuario(user) {
  const referenciaUsuario = doc(db, COLLECTIONS.users, user.uid);
  const snapshotUsuario = await getDoc(referenciaUsuario);

  if (snapshotUsuario.exists()) {
    const dados = snapshotUsuario.data();
    const atualizacao = {};
    const emailNormalizado = normalizarEmail(user.email);

    if (typeof dados.username === "undefined") {
      atualizacao.username = "";
    }

    if (typeof dados.email === "undefined" || normalizarEmail(dados.email) !== emailNormalizado) {
      atualizacao.email = emailNormalizado;
    }

    if (typeof dados.uid === "undefined") {
      atualizacao.uid = user.uid;
    }

    if (typeof dados.status === "undefined") {
      atualizacao.status = ehAdminEmail(user.email) ? "approved" : "pending";
    }

    if (ehAdminEmail(user.email) && dados.status !== "approved") {
      atualizacao.status = "approved";
    }

    if (Object.keys(atualizacao).length) {
      atualizacao.updatedAt = serverTimestamp();
      await updateDoc(referenciaUsuario, atualizacao);
      return { ...dados, ...atualizacao };
    }

    return dados;
  }

  const dadosIniciais = {
    uid: user.uid,
    email: normalizarEmail(user.email),
    username: "",
    status: ehAdminEmail(user.email) ? "approved" : "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(referenciaUsuario, dadosIniciais);
  return dadosIniciais;
}

async function registrarUsuario(email, senha) {
  let credencial = null;

  try {
    credencial = await createUserWithEmailAndPassword(auth, email, senha);
    await setDoc(doc(db, COLLECTIONS.users, credencial.user.uid), {
      uid: credencial.user.uid,
      email,
      username: "",
      status: ehAdminEmail(email) ? "approved" : "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await signOut(auth);
  } catch (erro) {
    if (credencial?.user) {
      try {
        await deleteUser(credencial.user);
      } catch (erroLimpeza) {
        registrarErroSeguranca("desfazer-cadastro-incompleto", erroLimpeza);
        try {
          await signOut(auth);
        } catch (erroLogout) {
          registrarErroSeguranca("encerrar-sessao-apos-falha-cadastro", erroLogout);
        }
      }
    }

    throw erro;
  }
}

async function fazerLogin(email, senha) {
  await signInWithEmailAndPassword(auth, email, senha);
}

async function fazerLogout() {
  await signOut(auth);
}

async function reautenticarUsuarioAtual(senhaAtual) {
  if (!auth.currentUser?.email) {
    throw new Error("Não foi possível identificar o e-mail da conta atual.");
  }

  const credencial = EmailAuthProvider.credential(auth.currentUser.email, senhaAtual);
  await reauthenticateWithCredential(auth.currentUser, credencial);
}

function calcularResumo(transacoes) {
  const entradas = transacoes
    .filter((item) => item.tipo === "entrada")
    .reduce((total, item) => total + item.valor, 0);

  const saidas = transacoes
    .filter((item) => item.tipo === "saida")
    .reduce((total, item) => total + item.valor, 0);

  return {
    entradas,
    saidas,
    saldo: entradas - saidas
  };
}

function ordenarTransacoes(transacoes) {
  return [...transacoes].sort((atual, proxima) => {
    if (atual.data === proxima.data) {
      return (proxima.createdAtMs || 0) - (atual.createdAtMs || 0);
    }

    return atual.data < proxima.data ? 1 : -1;
  });
}

function ordenarUsuarios(usuarios) {
  return [...usuarios].sort((atual, proxima) => {
    return (atual.email || "").localeCompare(proxima.email || "", "pt-BR");
  });
}

function usuarioPodeSerGerenciado(usuario) {
  return Boolean(usuario?.email) && !ehAdminEmail(usuario.email);
}

function renderizarTransacoes(transacoes) {
  const resumo = calcularResumo(transacoes);
  elementos.saldoAtual.textContent = formatarMoeda(resumo.saldo);
  elementos.totalEntradas.textContent = formatarMoeda(resumo.entradas);
  elementos.totalSaidas.textContent = formatarMoeda(resumo.saidas);

  if (!transacoes.length) {
    resetarResumoFinanceiro();
    return;
  }

  elementos.listaTransacoes.innerHTML = ordenarTransacoes(transacoes)
    .map((transacao) => {
      const classe = transacao.tipo === "entrada" ? "entrada" : "saida";
      const valor = transacao.tipo === "entrada"
        ? `+${formatarMoeda(transacao.valor)}`
        : `-${formatarMoeda(transacao.valor)}`;
      const descricao = escaparHtml(transacao.descricao);
      const data = escaparHtml(formatarData(transacao.data));
      const id = escaparHtml(transacao.id);

      return `
        <article class="linha-transacao">
          <span class="pill-tipo ${classe}">${transacao.tipo === "entrada" ? "Entrada" : "Saída"}</span>
          <div>
            <h4>${descricao}</h4>
            <small>${data}</small>
          </div>
          <div class="valor-transacao ${classe}">
            <p>${valor}</p>
            <small>Lançamento financeiro</small>
          </div>
          <button class="botao-excluir" type="button" data-excluir="${id}">
            Excluir
          </button>
        </article>
      `;
    })
    .join("");
}

function criarAcoesAdmin(usuario) {
  if (!usuarioPodeSerGerenciado(usuario)) {
    return "";
  }

  const uid = escaparHtml(usuario.uid);
  const email = escaparHtml(usuario.email);

  if (usuario.status === "pending") {
    return `
      <button class="botao-admin-acao" type="button" data-acao-admin="approve" data-uid="${uid}" data-email="${email}">
        Aprovar
      </button>
      <button class="botao-admin-acao rejeitar" type="button" data-acao-admin="reject" data-uid="${uid}" data-email="${email}">
        Rejeitar
      </button>
    `;
  }

  if (usuario.status === "approved") {
    return `
      <button class="botao-admin-acao" type="button" data-acao-admin="deactivate" data-uid="${uid}" data-email="${email}">
        Desativar conta
      </button>
      <button class="botao-admin-acao senha" type="button" data-acao-admin="password_reset_email" data-uid="${uid}" data-email="${email}">
        Enviar redefinição
      </button>
      <button class="botao-admin-acao excluir" type="button" data-acao-admin="delete" data-uid="${uid}" data-email="${email}">
        Excluir conta
      </button>
    `;
  }

  if (usuario.status === "rejected" || usuario.status === "deactivated") {
    const textoReativacao = usuario.status === "rejected" ? "Aprovar novamente" : "Reativar conta";

    return `
      <button class="botao-admin-acao" type="button" data-acao-admin="reactivate" data-uid="${uid}" data-email="${email}">
        ${textoReativacao}
      </button>
      <button class="botao-admin-acao excluir" type="button" data-acao-admin="delete" data-uid="${uid}" data-email="${email}">
        Excluir conta
      </button>
    `;
  }

  return "";
}

function renderizarUsuariosAdmin(usuarios) {
  const usuariosFiltrados = ordenarUsuarios(
    usuarios.filter((usuario) => usuarioPodeSerGerenciado(usuario))
  );

  if (!usuariosFiltrados.length) {
    elementos.listaUsuariosAdmin.innerHTML = `
      <div class="transacao-vazia">
        <p>Nenhum usuário gerenciável foi localizado.</p>
      </div>
    `;
    return;
  }

  elementos.listaUsuariosAdmin.innerHTML = usuariosFiltrados
    .map((usuario) => {
      const nomeExibicao = escaparHtml(usuario.username?.trim() || usuario.email);
      const email = escaparHtml(usuario.email);
      const status = escaparHtml(usuario.status);
      const textoStatus = escaparHtml(STATUS_LABEL[usuario.status] || usuario.status);

      return `
        <article class="linha-admin" data-uid="${escaparHtml(usuario.uid)}">
          <div>
            <strong>${nomeExibicao}</strong>
            <small>${email}</small>
          </div>
          <span class="pill-status ${status}">${textoStatus}</span>
          <div class="acoes-admin">
            ${criarAcoesAdmin(usuario)}
          </div>
        </article>
      `;
    })
    .join("");
}

function obterMensagemContaExcluida(marcador) {
  if (marcador?.deletedBy === "self") {
    return "Sua conta foi excluída e os dados locais foram removidos.";
  }

  return "Sua conta foi excluída do sistema e o acesso foi bloqueado.";
}

function iniciarEscutaTransacoes(uid) {
  if (limpezaEscutaTransacoes) {
    limpezaEscutaTransacoes();
  }

  const consulta = query(collection(db, COLLECTIONS.transactions), where("uid", "==", uid));
  limpezaEscutaTransacoes = onSnapshot(
    consulta,
    (snapshot) => {
      const transacoes = snapshot.docs.map((item) => {
        const dados = item.data();
        return {
          id: item.id,
          ...dados,
          createdAtMs: dados.createdAt?.toMillis ? dados.createdAt.toMillis() : 0
        };
      });

      renderizarTransacoes(transacoes);
    },
    (erro) => {
      registrarErroSeguranca("carregar-transacoes", erro);
      exibirMensagem(
        elementos.mensagemApp,
        traduzirErroFirestore(erro, "Não foi possível carregar as transações."),
        "erro"
      );
    }
  );
}

function iniciarEscutaUsuariosAdmin() {
  if (limpezaEscutaUsuarios) {
    limpezaEscutaUsuarios();
  }

  limpezaEscutaUsuarios = onSnapshot(
    collection(db, COLLECTIONS.users),
    (snapshot) => {
      const usuarios = snapshot.docs.map((item) => item.data());
      renderizarUsuariosAdmin(usuarios);
    },
    (erro) => {
      registrarErroSeguranca("carregar-usuarios-admin", erro);
      exibirMensagem(
        elementos.mensagemApp,
        traduzirErroFirestore(erro, "Não foi possível carregar a lista de usuários."),
        "erro"
      );
    }
  );
}

async function excluirTransacoesDoUsuario(uid) {
  if (!uid) {
    throw new Error("UID do usuário não informado para exclusão das transações.");
  }

  const consulta = query(collection(db, COLLECTIONS.transactions), where("uid", "==", uid));
  const snapshot = await getDocs(consulta);
  await Promise.all(snapshot.docs.map((item) => deleteDoc(doc(db, COLLECTIONS.transactions, item.id))));
}

async function obterUsuarioPorUid(uid) {
  const snapshotUsuario = await getDoc(doc(db, COLLECTIONS.users, uid));
  if (!snapshotUsuario.exists()) {
    return null;
  }

  return snapshotUsuario.data();
}

async function registrarMarcadorExclusao(uid, email, deletedBy) {
  await setDoc(doc(db, COLLECTIONS.deletedAccounts, uid), {
    uid,
    email: normalizarEmail(email),
    deletedBy,
    deletedAt: serverTimestamp()
  });
}

async function validarAcesso(user) {
  const marcadorExclusao = await obterMarcadorExclusao(user.uid);
  if (marcadorExclusao) {
    return {
      permitido: false,
      status: "deleted",
      mensagem: obterMensagemContaExcluida(marcadorExclusao)
    };
  }

  const dados = await garantirDocumentoUsuario(user);

  if (ehAdminEmail(user.email)) {
    return {
      permitido: true,
      admin: true,
      perfil: dados
    };
  }

  if (dados.status === "approved") {
    return {
      permitido: true,
      admin: false,
      perfil: dados
    };
  }

  if (dados.status === "pending") {
    return {
      permitido: false,
      status: "pending",
      mensagem: "Cadastro enviado com sucesso. Aguarde a aprovação do administrador."
    };
  }

  if (dados.status === "rejected") {
    return {
      permitido: false,
      status: "rejected",
      mensagem: "Seu acesso foi negado pelo administrador."
    };
  }

  return {
    permitido: false,
    status: "deactivated",
    mensagem: "Conta desativada pelo administrador."
  };
}

function iniciarEscutaStatusUsuario(user) {
  if (limpezaEscutaStatus) {
    limpezaEscutaStatus();
  }

  limpezaEscutaStatus = onSnapshot(
    doc(db, COLLECTIONS.users, user.uid),
    async (snapshotUsuario) => {
      if (!snapshotUsuario.exists()) {
        if (exclusaoContaAtualEmAndamento) {
          return;
        }

        try {
          const marcadorExclusao = await obterMarcadorExclusao(user.uid);
          exibirMensagem(
            elementos.mensagemAuth,
            marcadorExclusao
              ? obterMensagemContaExcluida(marcadorExclusao)
              : "Sua conta foi removida do sistema. O acesso ao aplicativo foi bloqueado.",
            "erro"
          );
        } catch (erroLeitura) {
          registrarErroSeguranca("validar-exclusao-conta", erroLeitura);
          exibirMensagem(
            elementos.mensagemAuth,
            "Sua conta não está mais disponível no sistema.",
            "erro"
          );
        }

        await fazerLogout();
        return;
      }

      const dados = snapshotUsuario.data();
      perfilAtual = dados;
      atualizarCabecalho();

      if (!dados.username?.trim()) {
        abrirModalPerfil(true, "");
      } else if (!elementos.modalPerfil.classList.contains("oculto")) {
        elementos.campoUsername.value = dados.username;
      }

      if (!ehAdminEmail(user.email) && dados.status !== "approved") {
        const mensagem = dados.status === "deactivated"
          ? "Conta desativada pelo administrador."
          : dados.status === "rejected"
            ? "Seu acesso foi negado pelo administrador."
            : "Seu cadastro está aguardando a aprovação do administrador.";

        exibirMensagem(elementos.mensagemAuth, mensagem, dados.status === "pending" ? "info" : "erro");
        await fazerLogout();
      }
    },
    async (erro) => {
      registrarErroSeguranca("observar-status-usuario", erro);
      exibirMensagem(
        elementos.mensagemAuth,
        traduzirErroFirestore(erro, "Não foi possível validar o status da conta."),
        "erro"
      );
      await fazerLogout();
    }
  );
}

async function prepararApp(user, perfil) {
  usuarioAtual = user;
  perfilAtual = perfil;
  atualizarCabecalho();
  atualizarVisibilidadeAcoesDoTopo();
  ocultarMensagem(elementos.mensagemApp);
  resetarFormularioTransacao();
  mostrarTelaApp();
  iniciarEscutaTransacoes(user.uid);
  iniciarEscutaStatusUsuario(user);

  if (ehAdminEmail(user.email)) {
    elementos.secaoAdmin.classList.remove("oculto");
    iniciarEscutaUsuariosAdmin();
  } else {
    resetarPainelAdmin();
  }

  if (!perfil?.username?.trim()) {
    abrirModalPerfil(true, "");
  }
}

async function tratarMudancaAutenticacao(user) {
  if (cadastroEmAndamento && user) {
    return;
  }

  limparEscutas();

  if (!user) {
    mostrarTelaAuth();
    return;
  }

  try {
    const validacao = await validarAcesso(user);

    if (!validacao.permitido) {
      exibirMensagem(
        elementos.mensagemAuth,
        validacao.mensagem,
        validacao.status === "pending" ? "sucesso" : "erro"
      );
      await fazerLogout();
      return;
    }

    await prepararApp(user, validacao.perfil);
  } catch (erro) {
    registrarErroSeguranca("tratar-autenticacao", erro);
    const mensagem = erro?.code?.startsWith("auth/")
      ? traduzirErroAuth(erro.code)
      : traduzirErroFirestore(erro, "Não foi possível validar seu acesso no momento.");

    exibirMensagem(elementos.mensagemAuth, mensagem, "erro");
    await fazerLogout();
  }
}

function validarFormularioAuth(email, senha) {
  if (!email || !senha) {
    return "Preencha todos os campos obrigatórios.";
  }

  if (!validarEmail(email)) {
    return "Informe um e-mail válido.";
  }

  if (senha.length < 6) {
    return "A senha deve conter no mínimo 6 caracteres.";
  }

  return "";
}

async function enviarRegistro(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemAuth);

  const dados = new FormData(elementos.formAuth);
  const email = normalizarEmail(dados.get("email"));
  const senha = String(dados.get("senha") || "");
  const erroValidacao = validarFormularioAuth(email, senha);

  if (erroValidacao) {
    exibirMensagem(elementos.mensagemAuth, erroValidacao, "erro");
    return;
  }

  const botao = evento.submitter || elementos.botaoSubmitAuth;
  const emModoLogin = modoAuthAtual === "login";

  await executarComEstadoDeCarregamento(botao, emModoLogin ? "Entrando..." : "Criando conta...", async () => {
    try {
      if (emModoLogin) {
        await fazerLogin(email, senha);
        elementos.formAuth.reset();
        return;
      }

      cadastroEmAndamento = true;
      await registrarUsuario(email, senha);
      elementos.formAuth.reset();
      definirModoAuth("login");
      exibirMensagem(
        elementos.mensagemAuth,
        "Conta criada com sucesso. Aguarde aprovação do administrador.",
        "sucesso"
      );
      window.location.reload();
      return;
    } catch (erro) {
      registrarErroSeguranca(emModoLogin ? "login" : "registro", erro);
      const mensagem = erro?.code?.startsWith("auth/")
        ? traduzirErroAuth(erro.code)
        : traduzirErroFirestore(erro, emModoLogin ? "Não foi possível concluir o login." : "Não foi possível concluir o cadastro.");
      exibirMensagem(elementos.mensagemAuth, mensagem, "erro");
    } finally {
      if (!emModoLogin) {
        cadastroEmAndamento = false;
      }
    }
  });
}

function validarFormularioTransacao(tipo, valor, descricao, data) {
  if (!tipo || !descricao || !data) {
    return "Preencha todos os campos obrigatórios da transação.";
  }

  if (!["entrada", "saida"].includes(tipo)) {
    return "Selecione um tipo de transação válido.";
  }

  if (!Number.isFinite(valor) || valor <= 0) {
    return "Informe um valor financeiro válido.";
  }

  if (valor > LIMITE_VALOR) {
    return "O valor informado excede o limite permitido.";
  }

  if (descricao.trim().length < 3) {
    return "A descrição deve conter pelo menos 3 caracteres.";
  }

  if (descricao.trim().length > 80) {
    return "A descrição deve conter no máximo 80 caracteres.";
  }

  if (!validarDataIso(data)) {
    return "Informe uma data válida para a transação.";
  }

  return "";
}

async function enviarTransacao(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemApp);

  if (!usuarioAutenticado()) {
    exibirMensagem(elementos.mensagemApp, "Entre novamente para registrar uma transação.", "erro");
    return;
  }

  const dados = new FormData(elementos.formTransacao);
  const tipo = String(dados.get("tipo") || "");
  const valor = obterValorMonetarioDoCampo(elementos.transacaoValor);
  const descricao = String(dados.get("descricao") || "").trim().replace(/\s+/g, " ");
  const data = String(dados.get("data") || "");
  const erroValidacao = validarFormularioTransacao(tipo, valor, descricao, data);

  if (erroValidacao) {
    exibirMensagem(elementos.mensagemApp, erroValidacao, "erro");
    return;
  }

  const botao = evento.submitter || elementos.formTransacao.querySelector("button[type='submit']");

  await executarComEstadoDeCarregamento(botao, "Salvando...", async () => {
    try {
      await addDoc(collection(db, COLLECTIONS.transactions), {
        uid: usuarioAtual.uid,
        tipo,
        valor,
        descricao,
        data,
        createdAt: serverTimestamp()
      });

      resetarFormularioTransacao();
      exibirMensagem(elementos.mensagemApp, "Transação registrada com sucesso.", "sucesso");
    } catch (erro) {
      registrarErroSeguranca("registrar-transacao", erro);
      exibirMensagem(
        elementos.mensagemApp,
        traduzirErroFirestore(erro, "Não foi possível registrar a transação."),
        "erro"
      );
    }
  });
}

async function validarPermissaoDeExclusaoTransacao(id) {
  const referencia = doc(db, COLLECTIONS.transactions, id);
  const snapshotTransacao = await getDoc(referencia);

  if (!snapshotTransacao.exists()) {
    throw new Error("Transação não encontrada.");
  }

  const transacao = snapshotTransacao.data();
  const usuarioPodeExcluir = transacao.uid === usuarioAtual?.uid || podeAdministrar();

  if (!usuarioPodeExcluir) {
    throw new Error("Você não tem permissão para excluir esta transação.");
  }

  return referencia;
}

async function excluirTransacao(id, botao) {
  if (!window.confirm("Confirma a exclusão desta transação?")) {
    return;
  }

  await executarComEstadoDeCarregamento(botao, "Excluindo...", async () => {
    try {
      const referencia = await validarPermissaoDeExclusaoTransacao(id);
      await deleteDoc(referencia);
      exibirMensagem(elementos.mensagemApp, "Transação excluída com sucesso.", "sucesso");
    } catch (erro) {
      registrarErroSeguranca("excluir-transacao", erro);
      exibirMensagem(
        elementos.mensagemApp,
        traduzirErroFirestore(erro, "Não foi possível excluir a transação."),
        "erro"
      );
    }
  });
}

async function aprovarUsuario(uid) {
  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    status: "approved",
    updatedAt: serverTimestamp()
  });
}

async function rejeitarUsuario(uid) {
  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    status: "rejected",
    updatedAt: serverTimestamp()
  });
}

async function desativarUsuario(uid) {
  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    status: "deactivated",
    updatedAt: serverTimestamp()
  });
}

async function reativarUsuario(uid) {
  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    status: "approved",
    updatedAt: serverTimestamp()
  });
}

async function enviarResetSenhaPorEmail(email) {
  await sendPasswordResetEmail(auth, email);
}

async function excluirContaUsuarioAdmin(uid, email) {
  await registrarMarcadorExclusao(uid, email, "admin");
  await excluirTransacoesDoUsuario(uid);
  await deleteDoc(doc(db, COLLECTIONS.users, uid));
}

function confirmarAcaoAdmin(acao) {
  const mensagens = {
    deactivate: "Confirma a desativação desta conta?",
    reject: "Confirma a rejeição deste cadastro?",
    password_reset_email: "Deseja enviar um e-mail de redefinição de senha para este usuário?",
    delete: "Confirma a exclusão desta conta e dos dados financeiros?"
  };

  if (!mensagens[acao]) {
    return true;
  }

  return window.confirm(mensagens[acao]);
}

async function executarAcaoAdmin(acao, uid, email) {
  if (!podeAdministrar()) {
    throw new Error("Ação administrativa permitida apenas para o administrador configurado.");
  }

  if (!uid || !email) {
    throw new Error("UID ou e-mail do usuário não informado.");
  }

  const usuario = await obterUsuarioPorUid(uid);
  if (!usuario) {
    throw new Error("Usuário não encontrado para a operação solicitada.");
  }

  if (ehAdminEmail(usuario.email)) {
    throw new Error("A conta administrativa não pode ser alterada por este painel.");
  }

  if (uid === usuarioAtual.uid || normalizarEmail(email) === ADMIN_EMAIL_NORMALIZADO) {
    throw new Error("A conta administrativa não pode ser excluída nem alterada por este painel.");
  }

  if (!confirmarAcaoAdmin(acao)) {
    return;
  }

  if (acao === "approve") {
    await aprovarUsuario(uid);
    exibirMensagem(elementos.mensagemApp, "Usuário aprovado com sucesso.", "sucesso");
    return;
  }

  if (acao === "reject") {
    await rejeitarUsuario(uid);
    exibirMensagem(elementos.mensagemApp, "Usuário rejeitado com sucesso.", "sucesso");
    return;
  }

  if (acao === "deactivate") {
    await desativarUsuario(uid);
    exibirMensagem(elementos.mensagemApp, "Conta desativada com sucesso.", "sucesso");
    return;
  }

  if (acao === "reactivate") {
    await reativarUsuario(uid);
    exibirMensagem(elementos.mensagemApp, "Conta reativada com sucesso.", "sucesso");
    return;
  }

  if (acao === "password_reset_email") {
    await enviarResetSenhaPorEmail(email);
    exibirMensagem(elementos.mensagemApp, "E-mail de redefinição enviado com sucesso.", "sucesso");
    return;
  }

  if (acao === "delete") {
    await excluirContaUsuarioAdmin(uid, email);
    exibirMensagem(
      elementos.mensagemApp,
      "Conta removida do painel. Novos acessos foram bloqueados para este UID.",
      "info"
    );
    return;
  }

  throw new Error(`Ação administrativa desconhecida: ${acao}`);
}

async function excluirMinhaConta() {
  if (!usuarioAutenticado()) {
    exibirMensagem(elementos.mensagemApp, "Não foi possível validar sua sessão para excluir a conta.", "erro");
    return;
  }

  if (ehAdminEmail(usuarioAtual.email)) {
    exibirMensagem(elementos.mensagemApp, "A conta administrativa não pode ser excluída por esta interface.", "erro");
    return;
  }

  if (!window.confirm("Confirma a exclusão da sua conta e de todas as suas transações?")) {
    return;
  }

  await executarComEstadoDeCarregamento(elementos.botaoExcluirMinhaConta, "Excluindo...", async () => {
    try {
      const senhaAtual = window.prompt("Para confirmar a exclusão da conta, informe sua senha atual:");
      if (senhaAtual === null) {
        return;
      }

      if (senhaAtual.length < 6) {
        exibirMensagem(elementos.mensagemApp, "Informe corretamente sua senha atual para excluir a conta.", "erro");
        return;
      }

      await reautenticarUsuarioAtual(senhaAtual);
      exclusaoContaAtualEmAndamento = true;

      exibirMensagem(
        elementos.mensagemAuth,
        "Conta excluída com sucesso.",
        "sucesso"
      );

      await registrarMarcadorExclusao(usuarioAtual.uid, usuarioAtual.email, "self");
      await excluirTransacoesDoUsuario(usuarioAtual.uid);
      await deleteDoc(doc(db, COLLECTIONS.users, usuarioAtual.uid));
      await deleteUser(auth.currentUser);
    } catch (erro) {
      exclusaoContaAtualEmAndamento = false;
      registrarErroSeguranca("excluir-propria-conta", erro);

      const mensagem = erro?.code?.startsWith("auth/")
        ? traduzirErroAuth(erro.code)
        : traduzirErroFirestore(erro, "Não foi possível excluir a conta.");
      exibirMensagem(elementos.mensagemApp, mensagem, "erro");
    }
  });
}

async function salvarUsername(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemPerfil);

  if (!usuarioAutenticado()) {
    exibirMensagem(elementos.mensagemPerfil, "Entre novamente para atualizar o perfil.", "erro");
    return;
  }

  const dados = new FormData(elementos.formPerfil);
  const username = String(dados.get("username") || "").trim().replace(/\s+/g, " ");
  const erroValidacao = validarUsername(username);

  if (erroValidacao) {
    exibirMensagem(elementos.mensagemPerfil, erroValidacao, "erro");
    return;
  }

  const botao = evento.submitter || elementos.formPerfil.querySelector("button[type='submit']");

  await executarComEstadoDeCarregamento(botao, "Salvando...", async () => {
    try {
      await updateDoc(doc(db, COLLECTIONS.users, usuarioAtual.uid), {
        username,
        updatedAt: serverTimestamp()
      });
      exibirMensagem(elementos.mensagemPerfil, "Nome de usuário atualizado com sucesso.", "sucesso");
      exibirMensagem(elementos.mensagemApp, "Perfil atualizado com sucesso.", "sucesso");
      perfilAtual = { ...perfilAtual, username };
      atualizarCabecalho();
      window.setTimeout(() => {
        fecharModalPerfil();
      }, 450);
    } catch (erro) {
      registrarErroSeguranca("salvar-username", erro);
      exibirMensagem(
        elementos.mensagemPerfil,
        traduzirErroFirestore(erro, "Não foi possível salvar o nome de usuário."),
        "erro"
      );
    }
  });
}

function abrirEdicaoPerfil() {
  if (!usuarioAtual) {
    exibirMensagem(elementos.mensagemApp, "Entre novamente para editar o perfil.", "erro");
    return;
  }

  abrirModalPerfil(false, perfilAtual?.username || "");
}

elementos.formAuth.addEventListener("submit", enviarRegistro);
elementos.formTransacao.addEventListener("submit", enviarTransacao);
elementos.formPerfil.addEventListener("submit", salvarUsername);

elementos.botaoModoLogin.addEventListener("click", () => {
  definirModoAuth("login");
});

elementos.botaoModoRegistro.addEventListener("click", () => {
  definirModoAuth("registro");
});

elementos.botaoLogout.addEventListener("click", async () => {
  await executarComEstadoDeCarregamento(elementos.botaoLogout, "Saindo...", async () => {
    try {
      await fazerLogout();
    } catch (erro) {
      registrarErroSeguranca("logout", erro);
      exibirMensagem(elementos.mensagemApp, traduzirErroAuth(erro.code), "erro");
    }
  });
});

elementos.botaoEditarPerfil.addEventListener("click", abrirEdicaoPerfil);
elementos.botaoExcluirMinhaConta.addEventListener("click", excluirMinhaConta);

elementos.botaoCancelarPerfil.addEventListener("click", () => {
  if (!modoPerfilObrigatorio) {
    fecharModalPerfil();
  }
});

elementos.modalFundoPerfil.addEventListener("click", () => {
  if (!modoPerfilObrigatorio) {
    fecharModalPerfil();
  }
});

document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape" && !modoPerfilObrigatorio && !elementos.modalPerfil.classList.contains("oculto")) {
    fecharModalPerfil();
  }
});

elementos.transacaoValor.addEventListener("input", () => {
  normalizarCampoMoeda(elementos.transacaoValor);
});

elementos.listaTransacoes.addEventListener("click", async (evento) => {
  const botao = evento.target.closest("button[data-excluir]");
  if (!botao) {
    return;
  }

  await excluirTransacao(botao.dataset.excluir, botao);
});

elementos.listaUsuariosAdmin.addEventListener("click", async (evento) => {
  const botao = evento.target.closest("button[data-acao-admin]");
  if (!botao) {
    return;
  }

  await executarComEstadoDeCarregamento(botao, "Processando...", async () => {
    try {
      await executarAcaoAdmin(botao.dataset.acaoAdmin, botao.dataset.uid, botao.dataset.email);
    } catch (erro) {
      registrarErroSeguranca("acao-administrativa", erro);
      const mensagem = erro?.code?.startsWith("auth/")
        ? traduzirErroAuth(erro.code)
        : traduzirErroFirestore(erro, "Não foi possível concluir a ação administrativa.");
      exibirMensagem(elementos.mensagemApp, mensagem, "erro");
    }
  });
});

definirDataPadrao();
resetarResumoFinanceiro();
atualizarInterfaceAuth();
onAuthStateChanged(auth, tratarMudancaAutenticacao);
