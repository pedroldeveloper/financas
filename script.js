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
  formLogin: document.getElementById("form-login"),
  formRegistro: document.getElementById("form-registro"),
  formTransacao: document.getElementById("form-transacao"),
  formPerfil: document.getElementById("form-perfil"),
  campoLoginEmail: document.getElementById("login-email"),
  campoLoginSenha: document.getElementById("login-senha"),
  botaoResetSenha: document.getElementById("botao-reset-senha"),
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

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function ehAdminEmail(email) {
  return normalizarEmail(email) === ADMIN_EMAIL_NORMALIZADO;
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
    return "Data invalida";
  }

  const data = new Date(`${dataString}T12:00:00`);
  if (Number.isNaN(data.getTime())) {
    return "Data invalida";
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

function resetarResumoFinanceiro() {
  elementos.saldoAtual.textContent = formatarMoeda(0);
  elementos.totalEntradas.textContent = formatarMoeda(0);
  elementos.totalSaidas.textContent = formatarMoeda(0);
  elementos.listaTransacoes.innerHTML = `
    <div class="transacao-vazia">
      <p>Nenhuma transacao foi registrada ate o momento.</p>
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
    "auth/email-already-in-use": "Este email ja esta em uso.",
    "auth/invalid-email": "O email informado e invalido.",
    "auth/missing-email": "Informe um email valido para continuar.",
    "auth/weak-password": "A senha e insuficiente. Utilize no minimo 6 caracteres.",
    "auth/user-not-found": "Nao foi localizada uma conta com este email.",
    "auth/wrong-password": "A senha informada esta incorreta.",
    "auth/invalid-login-credentials": "Email ou senha invalidos.",
    "auth/network-request-failed": "Falha de conexao. Verifique sua internet e tente novamente.",
    "auth/too-many-requests": "Foram detectadas muitas tentativas. Aguarde alguns minutos e tente novamente.",
    "auth/requires-recent-login": "Entre novamente e repita a acao para confirmar sua identidade."
  };

  return mapa[codigo] || "Ocorreu um erro inesperado. Verifique a configuracao do servico.";
}

function traduzirErroFirestore(erro, padrao) {
  console.error("Firestore error:", erro);

  if (!erro?.code) {
    return padrao;
  }

  const mapa = {
    "permission-denied": "Permissao negada pelo Firestore. Verifique as regras do projeto.",
    unavailable: "Servico indisponivel no momento. Tente novamente em instantes.",
    unauthenticated: "Sessao invalida. Entre novamente para continuar.",
    "not-found": "Registro nao encontrado.",
    cancelled: "Operacao cancelada."
  };

  return mapa[erro.code] || `${padrao} (${erro.code})`;
}

function validarUsername(username) {
  const limpo = String(username || "").trim().replace(/\s+/g, " ");

  if (!limpo) {
    return "Informe um nome de usuario.";
  }

  if (limpo.length < 3) {
    return "O nome de usuario deve conter pelo menos 3 caracteres.";
  }

  if (limpo.length > 30) {
    return "O nome de usuario deve conter no maximo 30 caracteres.";
  }

  if (!/^[\p{L}\p{N}._\-\s]+$/u.test(limpo)) {
    return "Utilize apenas letras, numeros, espacos, ponto, hifen ou sublinhado.";
  }

  return "";
}

function abrirModalPerfil(obrigatorio, usernameAtual = "") {
  modoPerfilObrigatorio = obrigatorio;
  elementos.tituloModalPerfil.textContent = obrigatorio ? "Definir nome de usuario" : "Editar nome de usuario";
  elementos.textoModalPerfil.textContent = obrigatorio
    ? "Antes de continuar, defina o nome que sera exibido no sistema."
    : "Atualize o nome exibido no cabecalho e nas areas do sistema.";
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

  return user.email;
}

function atualizarCabecalho() {
  if (!usuarioAtual) {
    return;
  }

  const nomeExibicao = obterNomeExibicao(perfilAtual, usuarioAtual);
  elementos.tituloUsuario.textContent = `Ola, ${nomeExibicao}`;
  elementos.subtituloUsuario.textContent = `Conta vinculada ao email ${usuarioAtual.email}.`;
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
        console.error("Erro ao desfazer cadastro incompleto:", erroLimpeza);
        try {
          await signOut(auth);
        } catch (erroLogout) {
          console.error("Erro ao encerrar sessao apos falha no cadastro:", erroLogout);
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
    throw new Error("Nao foi possivel identificar o email da conta atual.");
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
          <span class="pill-tipo ${classe}">${transacao.tipo === "entrada" ? "Entrada" : "Saida"}</span>
          <div>
            <h4>${descricao}</h4>
            <small>${data}</small>
          </div>
          <div class="valor-transacao ${classe}">
            <p>${valor}</p>
            <small>Registro financeiro</small>
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
        Resetar senha
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
    usuarios.filter((usuario) => usuario.email && !ehAdminEmail(usuario.email))
  );

  if (!usuariosFiltrados.length) {
    elementos.listaUsuariosAdmin.innerHTML = `
      <div class="transacao-vazia">
        <p>Nenhum usuario gerenciavel foi localizado.</p>
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
    return "Sua conta foi excluida e os dados locais foram removidos.";
  }

  return "Sua conta foi excluida do sistema e o acesso foi bloqueado.";
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
      console.error("Erro ao carregar transacoes:", erro);
      exibirMensagem(
        elementos.mensagemApp,
        traduzirErroFirestore(erro, "Nao foi possivel carregar as transacoes."),
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
      console.error("Erro ao carregar usuarios admin:", erro);
      exibirMensagem(
        elementos.mensagemApp,
        traduzirErroFirestore(erro, "Nao foi possivel carregar a lista de usuarios."),
        "erro"
      );
    }
  );
}

async function excluirTransacoesDoUsuario(uid) {
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
      mensagem: "Cadastro enviado com sucesso. Aguarde aprovacao do administrador."
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
          console.error("Erro ao validar exclusao da conta:", erroLeitura);
          exibirMensagem(
            elementos.mensagemAuth,
            "Sua conta nao esta mais disponivel no sistema.",
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
            : "Seu cadastro esta aguardando aprovacao do administrador.";

        exibirMensagem(elementos.mensagemAuth, mensagem, dados.status === "pending" ? "info" : "erro");
        await fazerLogout();
      }
    },
    async (erro) => {
      console.error("Erro ao observar status do usuario:", erro);
      exibirMensagem(
        elementos.mensagemAuth,
        traduzirErroFirestore(erro, "Nao foi possivel validar o status da conta."),
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
    console.error("Erro ao tratar autenticacao:", erro);
    const mensagem = erro?.code?.startsWith("auth/")
      ? traduzirErroAuth(erro.code)
      : traduzirErroFirestore(erro, "Nao foi possivel validar seu acesso no momento.");

    exibirMensagem(elementos.mensagemAuth, mensagem, "erro");
    await fazerLogout();
  }
}

function validarFormularioAuth(email, senha) {
  if (!email || !senha) {
    return "Preencha todos os campos obrigatorios.";
  }

  if (!validarEmail(email)) {
    return "Informe um email valido.";
  }

  if (senha.length < 6) {
    return "A senha deve conter no minimo 6 caracteres.";
  }

  return "";
}

async function enviarRegistro(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemAuth);

  const dados = new FormData(elementos.formRegistro);
  const email = normalizarEmail(dados.get("email"));
  const senha = String(dados.get("senha") || "");
  const erroValidacao = validarFormularioAuth(email, senha);

  if (erroValidacao) {
    exibirMensagem(elementos.mensagemAuth, erroValidacao, "erro");
    return;
  }

  const botao = evento.submitter || elementos.formRegistro.querySelector("button[type='submit']");

  await executarComEstadoDeCarregamento(botao, "Registrando...", async () => {
    try {
      await registrarUsuario(email, senha);
      elementos.formRegistro.reset();
      exibirMensagem(
        elementos.mensagemAuth,
        "Cadastro enviado com sucesso. Aguarde aprovacao do administrador.",
        "sucesso"
      );
    } catch (erro) {
      console.error("Erro no registro:", erro);
      const mensagem = erro?.code?.startsWith("auth/")
        ? traduzirErroAuth(erro.code)
        : traduzirErroFirestore(erro, "Nao foi possivel concluir o cadastro.");
      exibirMensagem(elementos.mensagemAuth, mensagem, "erro");
    }
  });
}

async function enviarLogin(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemAuth);

  const dados = new FormData(elementos.formLogin);
  const email = normalizarEmail(dados.get("email"));
  const senha = String(dados.get("senha") || "");
  const erroValidacao = validarFormularioAuth(email, senha);

  if (erroValidacao) {
    exibirMensagem(elementos.mensagemAuth, erroValidacao, "erro");
    return;
  }

  const botao = evento.submitter || elementos.formLogin.querySelector("button[type='submit']");

  await executarComEstadoDeCarregamento(botao, "Entrando...", async () => {
    try {
      await fazerLogin(email, senha);
      elementos.formLogin.reset();
    } catch (erro) {
      console.error("Erro no login:", erro);
      exibirMensagem(elementos.mensagemAuth, traduzirErroAuth(erro.code), "erro");
    }
  });
}

async function solicitarResetSenha() {
  ocultarMensagem(elementos.mensagemAuth);

  const email = normalizarEmail(elementos.campoLoginEmail.value);
  if (!validarEmail(email)) {
    exibirMensagem(
      elementos.mensagemAuth,
      "Informe um email valido no campo de login para receber o link de redefinicao.",
      "erro"
    );
    elementos.campoLoginEmail.focus();
    return;
  }

  await executarComEstadoDeCarregamento(elementos.botaoResetSenha, "Enviando...", async () => {
    try {
      await sendPasswordResetEmail(auth, email);
      exibirMensagem(
        elementos.mensagemAuth,
        "Email de redefinicao enviado com sucesso. Verifique sua caixa de entrada.",
        "sucesso"
      );
    } catch (erro) {
      console.error("Erro ao enviar redefinicao de senha:", erro);
      exibirMensagem(elementos.mensagemAuth, traduzirErroAuth(erro.code), "erro");
    }
  });
}

function validarFormularioTransacao(tipo, valor, descricao, data) {
  if (!tipo || !descricao || !data) {
    return "Preencha todos os campos obrigatorios da transacao.";
  }

  if (!["entrada", "saida"].includes(tipo)) {
    return "Selecione um tipo de transacao valido.";
  }

  if (!Number.isFinite(valor) || valor <= 0) {
    return "Informe um valor financeiro valido.";
  }

  if (valor > LIMITE_VALOR) {
    return "O valor informado excede o limite permitido.";
  }

  if (descricao.trim().length < 3) {
    return "A descricao deve conter pelo menos 3 caracteres.";
  }

  if (descricao.trim().length > 80) {
    return "A descricao deve conter no maximo 80 caracteres.";
  }

  if (!validarDataIso(data)) {
    return "Informe uma data valida para a transacao.";
  }

  return "";
}

async function enviarTransacao(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemApp);

  if (!usuarioAtual) {
    exibirMensagem(elementos.mensagemApp, "Entre novamente para registrar uma transacao.", "erro");
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
      exibirMensagem(elementos.mensagemApp, "Transacao registrada com sucesso.", "sucesso");
    } catch (erro) {
      console.error("Erro ao registrar transacao:", erro);
      exibirMensagem(
        elementos.mensagemApp,
        traduzirErroFirestore(erro, "Nao foi possivel registrar a transacao."),
        "erro"
      );
    }
  });
}

async function excluirTransacao(id, botao) {
  if (!window.confirm("Confirma a exclusao desta transacao?")) {
    return;
  }

  await executarComEstadoDeCarregamento(botao, "Excluindo...", async () => {
    try {
      await deleteDoc(doc(db, COLLECTIONS.transactions, id));
      exibirMensagem(elementos.mensagemApp, "Transacao excluida com sucesso.", "sucesso");
    } catch (erro) {
      console.error("Erro ao excluir transacao:", erro);
      exibirMensagem(
        elementos.mensagemApp,
        traduzirErroFirestore(erro, "Nao foi possivel excluir a transacao."),
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
    deactivate: "Confirma a desativacao desta conta?",
    reject: "Confirma a rejeicao deste cadastro?",
    password_reset_email: "Deseja enviar um email para redefinicao de senha deste usuario?",
    delete: "Confirma a exclusao desta conta e dos dados financeiros?"
  };

  if (!mensagens[acao]) {
    return true;
  }

  return window.confirm(mensagens[acao]);
}

async function executarAcaoAdmin(acao, uid, email) {
  if (!usuarioAtual || !ehAdminEmail(usuarioAtual.email)) {
    throw new Error("Acao administrativa permitida apenas para o admin configurado.");
  }

  if (!uid || !email) {
    throw new Error("UID ou email do usuario nao informado.");
  }

  const usuario = await obterUsuarioPorUid(uid);
  if (!usuario) {
    throw new Error("Usuario nao encontrado para a operacao solicitada.");
  }

  if (ehAdminEmail(usuario.email)) {
    throw new Error("A conta administrativa nao pode ser alterada por este painel.");
  }

  if (!confirmarAcaoAdmin(acao)) {
    return;
  }

  if (acao === "approve") {
    await aprovarUsuario(uid);
    exibirMensagem(elementos.mensagemApp, "Usuario aprovado com sucesso.", "sucesso");
    return;
  }

  if (acao === "reject") {
    await rejeitarUsuario(uid);
    exibirMensagem(elementos.mensagemApp, "Usuario rejeitado com sucesso.", "sucesso");
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
    exibirMensagem(elementos.mensagemApp, "Email de redefinicao enviado com sucesso.", "sucesso");
    return;
  }

  if (acao === "delete") {
    await excluirContaUsuarioAdmin(uid, email);
    exibirMensagem(
      elementos.mensagemApp,
      "Conta removida do painel e novos acessos foram bloqueados para este UID.",
      "info"
    );
    return;
  }

  throw new Error(`Acao administrativa desconhecida: ${acao}`);
}

async function excluirMinhaConta() {
  if (!usuarioAtual || !auth.currentUser || auth.currentUser.uid !== usuarioAtual.uid) {
    exibirMensagem(elementos.mensagemApp, "Nao foi possivel validar sua sessao para excluir a conta.", "erro");
    return;
  }

  if (!window.confirm("Confirma a exclusao da sua conta e de todas as suas transacoes?")) {
    return;
  }

  await executarComEstadoDeCarregamento(elementos.botaoExcluirMinhaConta, "Excluindo...", async () => {
    try {
      const senhaAtual = window.prompt("Para confirmar a exclusao da conta, informe sua senha atual:");
      if (senhaAtual === null) {
        return;
      }

      if (senhaAtual.length < 6) {
        exibirMensagem(elementos.mensagemApp, "Informe sua senha atual corretamente para excluir a conta.", "erro");
        return;
      }

      await reautenticarUsuarioAtual(senhaAtual);
      exclusaoContaAtualEmAndamento = true;

      exibirMensagem(
        elementos.mensagemAuth,
        "Conta excluida com sucesso.",
        "sucesso"
      );

      await registrarMarcadorExclusao(usuarioAtual.uid, usuarioAtual.email, "self");
      await excluirTransacoesDoUsuario(usuarioAtual.uid);
      await deleteDoc(doc(db, COLLECTIONS.users, usuarioAtual.uid));
      await deleteUser(auth.currentUser);
    } catch (erro) {
      exclusaoContaAtualEmAndamento = false;
      console.error("Erro ao excluir a propria conta:", erro);

      const mensagem = erro?.code?.startsWith("auth/")
        ? traduzirErroAuth(erro.code)
        : traduzirErroFirestore(erro, "Nao foi possivel excluir a conta.");
      exibirMensagem(elementos.mensagemApp, mensagem, "erro");
    }
  });
}

async function salvarUsername(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemPerfil);

  if (!usuarioAtual) {
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
      exibirMensagem(elementos.mensagemPerfil, "Nome de usuario atualizado com sucesso.", "sucesso");
      exibirMensagem(elementos.mensagemApp, "Perfil atualizado com sucesso.", "sucesso");
      perfilAtual = { ...perfilAtual, username };
      atualizarCabecalho();
      window.setTimeout(() => {
        fecharModalPerfil();
      }, 450);
    } catch (erro) {
      console.error("Erro ao salvar username:", erro);
      exibirMensagem(
        elementos.mensagemPerfil,
        traduzirErroFirestore(erro, "Nao foi possivel salvar o nome de usuario."),
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

elementos.formRegistro.addEventListener("submit", enviarRegistro);
elementos.formLogin.addEventListener("submit", enviarLogin);
elementos.formTransacao.addEventListener("submit", enviarTransacao);
elementos.formPerfil.addEventListener("submit", salvarUsername);

elementos.botaoResetSenha.addEventListener("click", solicitarResetSenha);

elementos.botaoLogout.addEventListener("click", async () => {
  await executarComEstadoDeCarregamento(elementos.botaoLogout, "Saindo...", async () => {
    try {
      await fazerLogout();
    } catch (erro) {
      console.error("Erro ao sair:", erro);
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
      console.error("Erro ao executar acao administrativa:", erro);
      const mensagem = erro?.code?.startsWith("auth/")
        ? traduzirErroAuth(erro.code)
        : traduzirErroFirestore(erro, "Nao foi possivel concluir a acao administrativa.");
      exibirMensagem(elementos.mensagemApp, mensagem, "erro");
    }
  });
});

definirDataPadrao();
resetarResumoFinanceiro();
onAuthStateChanged(auth, tratarMudancaAutenticacao);
