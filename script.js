import { ADMIN_EMAIL, auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
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

const LOG_LABEL = {
  approve: "Aprovacao",
  reject: "Rejeicao",
  deactivate: "Desativacao",
  reactivate: "Reativacao",
  password_reset_email: "Reset de senha",
  delete: "Exclusao"
};

const LIMITE_CENTAVOS = 99_999_999_999_999;
const LIMITE_VALOR = LIMITE_CENTAVOS / 100;

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
  botaoLogout: document.getElementById("botao-logout"),
  botaoEditarPerfil: document.getElementById("botao-editar-perfil"),
  botaoCancelarPerfil: document.getElementById("botao-cancelar-perfil"),
  tituloUsuario: document.getElementById("titulo-usuario"),
  subtituloUsuario: document.getElementById("subtitulo-usuario"),
  saldoAtual: document.getElementById("saldo-atual"),
  totalEntradas: document.getElementById("total-entradas"),
  totalSaidas: document.getElementById("total-saidas"),
  listaTransacoes: document.getElementById("lista-transacoes"),
  secaoAdmin: document.getElementById("secao-admin"),
  listaUsuariosAdmin: document.getElementById("lista-usuarios-admin"),
  listaLogsAdmin: document.getElementById("lista-logs-admin"),
  transacaoData: document.getElementById("transacao-data"),
  transacaoValor: document.getElementById("transacao-valor"),
  modalPerfil: document.getElementById("modal-perfil"),
  tituloModalPerfil: document.getElementById("titulo-modal-perfil"),
  textoModalPerfil: document.getElementById("texto-modal-perfil"),
  campoUsername: document.getElementById("perfil-username")
};

let usuarioAtual = null;
let perfilAtual = null;
let limpezaEscutaTransacoes = null;
let limpezaEscutaUsuarios = null;
let limpezaEscutaStatus = null;
let limpezaEscutaLogs = null;
let modoPerfilObrigatorio = false;

function exibirMensagem(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = `mensagem ${tipo}`;
}

function ocultarMensagem(elemento) {
  elemento.textContent = "";
  elemento.className = "mensagem oculto";
}

function definirDataPadrao() {
  elementos.transacaoData.value = new Date().toISOString().slice(0, 10);
}

function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(valor);
}

function formatarData(dataString) {
  return new Date(`${dataString}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatarTimestamp(timestamp) {
  if (!timestamp?.toDate) {
    return "Data indisponivel";
  }

  return timestamp.toDate().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

  if (limpezaEscutaLogs) {
    limpezaEscutaLogs();
    limpezaEscutaLogs = null;
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

function mostrarTelaAuth() {
  usuarioAtual = null;
  perfilAtual = null;
  limparEscutas();
  fecharModalPerfil();
  elementos.telaApp.classList.add("oculto");
  elementos.telaAuth.classList.remove("oculto");
  elementos.secaoAdmin.classList.add("oculto");
}

function mostrarTelaApp() {
  elementos.telaAuth.classList.add("oculto");
  elementos.telaApp.classList.remove("oculto");
}

function traduzirErroAuth(codigo) {
  const mapa = {
    "auth/email-already-in-use": "Este email ja esta em uso.",
    "auth/invalid-email": "O email informado e invalido.",
    "auth/weak-password": "A senha e insuficiente. Utilize no minimo 6 caracteres.",
    "auth/user-not-found": "Nao foi localizada uma conta com este email.",
    "auth/wrong-password": "A senha informada esta incorreta.",
    "auth/invalid-login-credentials": "Email ou senha invalidos.",
    "auth/network-request-failed": "Falha de conexao. Verifique sua internet e tente novamente.",
    "auth/too-many-requests": "Foram detectadas muitas tentativas. Aguarde alguns minutos e tente novamente."
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
  const limpo = username.trim();

  if (!limpo) {
    return "Informe um nome de usuario.";
  }

  if (limpo.length < 3) {
    return "O nome de usuario deve conter pelo menos 3 caracteres.";
  }

  if (limpo.length > 30) {
    return "O nome de usuario deve conter no maximo 30 caracteres.";
  }

  if (!/^[a-zA-Z0-9._\-\sÀ-ÿ]+$/.test(limpo)) {
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

async function garantirDocumentoUsuario(user) {
  const referenciaUsuario = doc(db, "users", user.uid);
  const snapshotUsuario = await getDoc(referenciaUsuario);

  if (snapshotUsuario.exists()) {
    const dados = snapshotUsuario.data();
    const atualizacao = {};

    if (typeof dados.username === "undefined") {
      atualizacao.username = "";
    }

    if (typeof dados.email === "undefined") {
      atualizacao.email = user.email;
    }

    if (typeof dados.uid === "undefined") {
      atualizacao.uid = user.uid;
    }

    if (user.email === ADMIN_EMAIL && dados.status !== "approved") {
      atualizacao.status = "approved";
    }

    if (Object.keys(atualizacao).length) {
      await updateDoc(referenciaUsuario, atualizacao);
      return { ...dados, ...atualizacao };
    }

    return dados;
  }

  const dadosIniciais = {
    uid: user.uid,
    email: user.email,
    username: "",
    status: user.email === ADMIN_EMAIL ? "approved" : "pending",
    createdAt: serverTimestamp()
  };

  await setDoc(referenciaUsuario, dadosIniciais);
  return dadosIniciais;
}

async function registrarUsuario(email, senha) {
  const credencial = await createUserWithEmailAndPassword(auth, email, senha);
  await setDoc(doc(db, "users", credencial.user.uid), {
    uid: credencial.user.uid,
    email,
    username: "",
    status: "pending",
    createdAt: serverTimestamp()
  });
  await signOut(auth);
}

async function fazerLogin(email, senha) {
  await signInWithEmailAndPassword(auth, email, senha);
}

async function fazerLogout() {
  await signOut(auth);
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

function ordenarLogs(logs) {
  return [...logs].sort((atual, proxima) => {
    const atualMs = atual.createdAt?.toMillis ? atual.createdAt.toMillis() : 0;
    const proximaMs = proxima.createdAt?.toMillis ? proxima.createdAt.toMillis() : 0;
    return proximaMs - atualMs;
  });
}

function renderizarTransacoes(transacoes) {
  const resumo = calcularResumo(transacoes);
  elementos.saldoAtual.textContent = formatarMoeda(resumo.saldo);
  elementos.totalEntradas.textContent = formatarMoeda(resumo.entradas);
  elementos.totalSaidas.textContent = formatarMoeda(resumo.saidas);

  if (!transacoes.length) {
    elementos.listaTransacoes.innerHTML = `
      <div class="transacao-vazia">
        <p>Nenhuma transacao foi registrada ate o momento.</p>
      </div>
    `;
    return;
  }

  elementos.listaTransacoes.innerHTML = ordenarTransacoes(transacoes)
    .map((transacao) => {
      const classe = transacao.tipo === "entrada" ? "entrada" : "saida";
      const valor = transacao.tipo === "entrada"
        ? `+${formatarMoeda(transacao.valor)}`
        : `-${formatarMoeda(transacao.valor)}`;

      return `
        <article class="linha-transacao">
          <span class="pill-tipo ${classe}">${transacao.tipo === "entrada" ? "Entrada" : "Saida"}</span>
          <div>
            <h4>${transacao.descricao}</h4>
            <small>${formatarData(transacao.data)}</small>
          </div>
          <div class="valor-transacao ${classe}">
            <p>${valor}</p>
            <small>Registro financeiro</small>
          </div>
          <button class="botao-excluir" type="button" data-excluir="${transacao.id}">Excluir</button>
        </article>
      `;
    })
    .join("");
}

function criarAcoesAdmin(usuario) {
  if (usuario.status === "pending") {
    return `
      <button class="botao-admin-acao" type="button" data-acao-admin="approve" data-uid="${usuario.uid}" data-email="${usuario.email}">
        Aprovar
      </button>
      <button class="botao-admin-acao rejeitar" type="button" data-acao-admin="reject" data-uid="${usuario.uid}" data-email="${usuario.email}">
        Rejeitar
      </button>
    `;
  }

  if (usuario.status === "approved") {
    return `
      <button class="botao-admin-acao" type="button" data-acao-admin="deactivate" data-uid="${usuario.uid}" data-email="${usuario.email}">
        Desativar conta
      </button>
      <button class="botao-admin-acao senha" type="button" data-acao-admin="password_reset_email" data-uid="${usuario.uid}" data-email="${usuario.email}">
        Resetar senha
      </button>
      <button class="botao-admin-acao excluir" type="button" data-acao-admin="delete" data-uid="${usuario.uid}" data-email="${usuario.email}">
        Excluir conta
      </button>
    `;
  }

  if (usuario.status === "rejected" || usuario.status === "deactivated") {
    return `
      ${usuario.status === "deactivated" ? `
        <button class="botao-admin-acao" type="button" data-acao-admin="reactivate" data-uid="${usuario.uid}" data-email="${usuario.email}">
          Reativar conta
        </button>
      ` : ""}
      <button class="botao-admin-acao excluir" type="button" data-acao-admin="delete" data-uid="${usuario.uid}" data-email="${usuario.email}">
        Excluir conta
      </button>
    `;
  }

  return "";
}

function renderizarUsuariosAdmin(usuarios) {
  const usuariosFiltrados = ordenarUsuarios(
    usuarios.filter((usuario) => usuario.email && usuario.email !== ADMIN_EMAIL)
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
      const nomeExibicao = usuario.username?.trim() || usuario.email;

      return `
        <article class="linha-admin" data-uid="${usuario.uid}">
          <div>
            <strong>${nomeExibicao}</strong>
            <small>${usuario.email}</small>
          </div>
          <span class="pill-status ${usuario.status}">${STATUS_LABEL[usuario.status] || usuario.status}</span>
          <div class="acoes-admin">
            ${criarAcoesAdmin(usuario)}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderizarLogsAdmin(logs) {
  if (!logs.length) {
    elementos.listaLogsAdmin.innerHTML = `
      <div class="transacao-vazia">
        <p>Nenhuma acao administrativa foi registrada.</p>
      </div>
    `;
    return;
  }

  elementos.listaLogsAdmin.innerHTML = ordenarLogs(logs)
    .map((log) => `
      <article class="linha-log">
        <span class="pill-log">${LOG_LABEL[log.actionType] || log.actionType}</span>
        <strong>${log.userEmail || "Usuario nao informado"}</strong>
        <p>UID: ${log.affectedUid || "Nao informado"}</p>
        <small>${formatarTimestamp(log.createdAt)}</small>
      </article>
    `)
    .join("");
}

function iniciarEscutaTransacoes(uid) {
  if (limpezaEscutaTransacoes) {
    limpezaEscutaTransacoes();
  }

  const consulta = query(collection(db, "transactions"), where("uid", "==", uid));
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
      exibirMensagem(elementos.mensagemApp, traduzirErroFirestore(erro, "Nao foi possivel carregar as transacoes."), "erro");
    }
  );
}

function iniciarEscutaUsuariosAdmin() {
  if (limpezaEscutaUsuarios) {
    limpezaEscutaUsuarios();
  }

  limpezaEscutaUsuarios = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      const usuarios = snapshot.docs.map((item) => item.data());
      renderizarUsuariosAdmin(usuarios);
    },
    (erro) => {
      console.error("Erro ao carregar usuarios admin:", erro);
      exibirMensagem(elementos.mensagemApp, traduzirErroFirestore(erro, "Nao foi possivel carregar a lista de usuarios."), "erro");
    }
  );
}

function iniciarEscutaLogsAdmin() {
  if (limpezaEscutaLogs) {
    limpezaEscutaLogs();
  }

  limpezaEscutaLogs = onSnapshot(
    collection(db, "admin_logs"),
    (snapshot) => {
      const logs = snapshot.docs.map((item) => item.data());
      renderizarLogsAdmin(logs);
    },
    (erro) => {
      console.error("Erro ao carregar logs admin:", erro);
      exibirMensagem(elementos.mensagemApp, traduzirErroFirestore(erro, "Nao foi possivel carregar os logs administrativos."), "erro");
    }
  );
}

async function registrarLogAdmin(actionType, affectedUid, userEmail) {
  try {
    await addDoc(collection(db, "admin_logs"), {
      actionType,
      affectedUid,
      userEmail,
      createdAt: serverTimestamp()
    });
  } catch (erro) {
    console.error("Erro ao registrar log admin:", erro);
    throw erro;
  }
}

async function excluirTransacoesDoUsuario(uid) {
  try {
    const consulta = query(collection(db, "transactions"), where("uid", "==", uid));
    const snapshot = await getDocs(consulta);
    await Promise.all(snapshot.docs.map((item) => deleteDoc(doc(db, "transactions", item.id))));
  } catch (erro) {
    console.error("Erro ao excluir transacoes do usuario:", erro);
    throw erro;
  }
}

async function obterUsuarioPorUid(uid) {
  try {
    const snapshotUsuario = await getDoc(doc(db, "users", uid));
    if (!snapshotUsuario.exists()) {
      return null;
    }

    return snapshotUsuario.data();
  } catch (erro) {
    console.error("Erro ao buscar usuario por UID:", erro);
    throw erro;
  }
}

async function validarAcesso(user) {
  const dados = await garantirDocumentoUsuario(user);

  if (user.email === ADMIN_EMAIL) {
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
    doc(db, "users", user.uid),
    async (snapshotUsuario) => {
      if (!snapshotUsuario.exists()) {
        exibirMensagem(
          elementos.mensagemAuth,
          "Sua conta foi removida do sistema. O acesso ao aplicativo foi bloqueado.",
          "erro"
        );
        await fazerLogout();
        return;
      }

      const dados = snapshotUsuario.data();
      perfilAtual = dados;
      atualizarCabecalho();

      if (!dados.username?.trim()) {
        abrirModalPerfil(true, "");
      } else if (!elementos.modalPerfil.classList.contains("oculto") && !modoPerfilObrigatorio) {
        elementos.campoUsername.value = dados.username;
      }

      if (user.email !== ADMIN_EMAIL && dados.status !== "approved") {
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
      exibirMensagem(elementos.mensagemAuth, traduzirErroFirestore(erro, "Nao foi possivel validar o status da conta."), "erro");
      await fazerLogout();
    }
  );
}

async function prepararApp(user, perfil) {
  usuarioAtual = user;
  perfilAtual = perfil;
  atualizarCabecalho();
  ocultarMensagem(elementos.mensagemApp);
  mostrarTelaApp();
  iniciarEscutaTransacoes(user.uid);
  iniciarEscutaStatusUsuario(user);

  if (user.email === ADMIN_EMAIL) {
    elementos.secaoAdmin.classList.remove("oculto");
    iniciarEscutaUsuariosAdmin();
    iniciarEscutaLogsAdmin();
  } else {
    elementos.secaoAdmin.classList.add("oculto");
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
    exibirMensagem(
      elementos.mensagemAuth,
      traduzirErroFirestore(erro, "Nao foi possivel validar seu acesso no momento."),
      "erro"
    );
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
  const email = dados.get("email").toString().trim();
  const senha = dados.get("senha").toString();

  const erroValidacao = validarFormularioAuth(email, senha);
  if (erroValidacao) {
    exibirMensagem(elementos.mensagemAuth, erroValidacao, "erro");
    return;
  }

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
    exibirMensagem(elementos.mensagemAuth, traduzirErroAuth(erro.code), "erro");
  }
}

async function enviarLogin(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemAuth);

  const dados = new FormData(elementos.formLogin);
  const email = dados.get("email").toString().trim();
  const senha = dados.get("senha").toString();

  const erroValidacao = validarFormularioAuth(email, senha);
  if (erroValidacao) {
    exibirMensagem(elementos.mensagemAuth, erroValidacao, "erro");
    return;
  }

  try {
    await fazerLogin(email, senha);
    elementos.formLogin.reset();
  } catch (erro) {
    console.error("Erro no login:", erro);
    exibirMensagem(elementos.mensagemAuth, traduzirErroAuth(erro.code), "erro");
  }
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

  return "";
}

async function enviarTransacao(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemApp);

  if (!usuarioAtual) {
    return;
  }

  const dados = new FormData(elementos.formTransacao);
  const tipo = dados.get("tipo").toString();
  const valor = obterValorMonetarioDoCampo(elementos.transacaoValor);
  const descricao = dados.get("descricao").toString().trim();
  const data = dados.get("data").toString();

  const erroValidacao = validarFormularioTransacao(tipo, valor, descricao, data);
  if (erroValidacao) {
    exibirMensagem(elementos.mensagemApp, erroValidacao, "erro");
    return;
  }

  try {
    await addDoc(collection(db, "transactions"), {
      uid: usuarioAtual.uid,
      tipo,
      valor,
      descricao,
      data,
      createdAt: serverTimestamp()
    });

    elementos.formTransacao.reset();
    elementos.transacaoValor.dataset.valorNumerico = "";
    definirDataPadrao();
    exibirMensagem(elementos.mensagemApp, "Transacao registrada com sucesso.", "sucesso");
  } catch (erro) {
    console.error("Erro ao registrar transacao:", erro);
    exibirMensagem(elementos.mensagemApp, traduzirErroFirestore(erro, "Nao foi possivel registrar a transacao."), "erro");
  }
}

async function excluirTransacao(id) {
  try {
    await deleteDoc(doc(db, "transactions", id));
    exibirMensagem(elementos.mensagemApp, "Transacao excluida com sucesso.", "sucesso");
  } catch (erro) {
    console.error("Erro ao excluir transacao:", erro);
    exibirMensagem(elementos.mensagemApp, traduzirErroFirestore(erro, "Nao foi possivel excluir a transacao."), "erro");
  }
}

async function aprovarUsuario(uid, email) {
  await updateDoc(doc(db, "users", uid), { status: "approved" });
  await registrarLogAdmin("approve", uid, email);
}

async function rejeitarUsuario(uid, email) {
  await updateDoc(doc(db, "users", uid), { status: "rejected" });
  await registrarLogAdmin("reject", uid, email);
}

async function desativarUsuario(uid, email) {
  await updateDoc(doc(db, "users", uid), { status: "deactivated" });
  await registrarLogAdmin("deactivate", uid, email);
}

async function reativarUsuario(uid, email) {
  await updateDoc(doc(db, "users", uid), { status: "approved" });
  await registrarLogAdmin("reactivate", uid, email);
}

async function enviarResetSenhaPorEmail(uid, email) {
  await sendPasswordResetEmail(auth, email);
  await registrarLogAdmin("password_reset_email", uid, email);
}

async function excluirContaUsuario(uid, email) {
  await excluirTransacoesDoUsuario(uid);
  await deleteDoc(doc(db, "users", uid));
  await registrarLogAdmin("delete", uid, email);
}

function confirmarAcaoAdmin(acao) {
  const mensagens = {
    deactivate: "Confirma a desativacao desta conta?",
    password_reset_email: "Deseja enviar um email para redefinicao de senha deste usuario?",
    delete: "Confirma a exclusao da conta deste usuario no Firestore?"
  };

  if (!mensagens[acao]) {
    return true;
  }

  return window.confirm(mensagens[acao]);
}

async function executarAcaoAdmin(acao, uid, email) {
  if (!usuarioAtual || usuarioAtual.email !== ADMIN_EMAIL) {
    throw new Error("Acao administrativa permitida apenas para o admin configurado.");
  }

  if (!uid || !email) {
    throw new Error("UID ou email do usuario nao informado.");
  }

  const usuario = await obterUsuarioPorUid(uid);
  if (!usuario) {
    throw new Error("Usuario nao encontrado para a operacao solicitada.");
  }

  if (usuario.email === ADMIN_EMAIL) {
    throw new Error("A conta administrativa nao pode ser alterada por este painel.");
  }

  if (!confirmarAcaoAdmin(acao)) {
    return;
  }

  if (acao === "approve") {
    await aprovarUsuario(uid, email);
    exibirMensagem(elementos.mensagemApp, "Usuario aprovado com sucesso.", "sucesso");
    return;
  }

  if (acao === "reject") {
    await rejeitarUsuario(uid, email);
    exibirMensagem(elementos.mensagemApp, "Usuario rejeitado com sucesso.", "sucesso");
    return;
  }

  if (acao === "deactivate") {
    await desativarUsuario(uid, email);
    exibirMensagem(elementos.mensagemApp, "Conta desativada com sucesso.", "sucesso");
    return;
  }

  if (acao === "reactivate") {
    await reativarUsuario(uid, email);
    exibirMensagem(elementos.mensagemApp, "Conta reativada com sucesso.", "sucesso");
    return;
  }

  if (acao === "password_reset_email") {
    await enviarResetSenhaPorEmail(uid, email);
    exibirMensagem(elementos.mensagemApp, "Email de redefinicao enviado com sucesso.", "sucesso");
    return;
  }

  if (acao === "delete") {
    await excluirContaUsuario(uid, email);
    exibirMensagem(
      elementos.mensagemApp,
      "Conta removida da colecao users e transacoes excluidas. A remocao do Firebase Authentication exige Admin SDK ou Cloud Function.",
      "info"
    );
    return;
  }

  throw new Error(`Acao administrativa desconhecida: ${acao}`);
}

async function salvarUsername(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemPerfil);

  if (!usuarioAtual) {
    return;
  }

  const dados = new FormData(elementos.formPerfil);
  const username = dados.get("username").toString().trim();
  const erroValidacao = validarUsername(username);

  if (erroValidacao) {
    exibirMensagem(elementos.mensagemPerfil, erroValidacao, "erro");
    return;
  }

  try {
    await updateDoc(doc(db, "users", usuarioAtual.uid), { username });
    exibirMensagem(elementos.mensagemPerfil, "Nome de usuario atualizado com sucesso.", "sucesso");
    exibirMensagem(elementos.mensagemApp, "Perfil atualizado com sucesso.", "sucesso");
    perfilAtual = { ...perfilAtual, username };
    atualizarCabecalho();
    window.setTimeout(() => {
      fecharModalPerfil();
    }, 500);
  } catch (erro) {
    console.error("Erro ao salvar username:", erro);
    exibirMensagem(elementos.mensagemPerfil, traduzirErroFirestore(erro, "Nao foi possivel salvar o nome de usuario."), "erro");
  }
}

function abrirEdicaoPerfil() {
  abrirModalPerfil(false, perfilAtual?.username || "");
}

elementos.formRegistro.addEventListener("submit", enviarRegistro);
elementos.formLogin.addEventListener("submit", enviarLogin);
elementos.formTransacao.addEventListener("submit", enviarTransacao);
elementos.formPerfil.addEventListener("submit", salvarUsername);

elementos.botaoLogout.addEventListener("click", async () => {
  await fazerLogout();
});

elementos.botaoEditarPerfil.addEventListener("click", abrirEdicaoPerfil);
elementos.botaoCancelarPerfil.addEventListener("click", () => {
  if (!modoPerfilObrigatorio) {
    fecharModalPerfil();
  }
});

elementos.transacaoValor.addEventListener("input", () => {
  normalizarCampoMoeda(elementos.transacaoValor);
});

elementos.listaTransacoes.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-excluir]");
  if (!botao) {
    return;
  }

  excluirTransacao(botao.dataset.excluir);
});

elementos.listaUsuariosAdmin.addEventListener("click", async (evento) => {
  const botao = evento.target.closest("button[data-acao-admin]");
  if (!botao) {
    return;
  }

  try {
    await executarAcaoAdmin(botao.dataset.acaoAdmin, botao.dataset.uid, botao.dataset.email);
  } catch (erro) {
    console.error("Erro ao executar acao administrativa:", erro);
    exibirMensagem(elementos.mensagemApp, traduzirErroFirestore(erro, "Nao foi possivel concluir a acao administrativa."), "erro");
  }
});

definirDataPadrao();
onAuthStateChanged(auth, tratarMudancaAutenticacao);
