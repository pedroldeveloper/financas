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
  limit,
  onSnapshot,
  orderBy,
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
  approve: "Aprovação",
  reject: "Rejeição",
  deactivate: "Desativação",
  reactivate: "Reativação",
  password_reset_email: "Reset de senha",
  delete: "Exclusão"
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
    return "Data indisponível";
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
    "auth/email-already-in-use": "Este email já está em uso.",
    "auth/invalid-email": "O email informado é inválido.",
    "auth/weak-password": "A senha é insuficiente. Utilize no mínimo 6 caracteres.",
    "auth/user-not-found": "Não foi localizada uma conta com este email.",
    "auth/wrong-password": "A senha informada está incorreta.",
    "auth/invalid-login-credentials": "Email ou senha inválidos.",
    "auth/network-request-failed": "Falha de conexão. Verifique sua internet e tente novamente.",
    "auth/too-many-requests": "Foram detectadas muitas tentativas. Aguarde alguns minutos e tente novamente."
  };

  return mapa[codigo] || "Ocorreu um erro inesperado. Verifique a configuração do serviço.";
}

function validarUsername(username) {
  const limpo = username.trim();

  if (!limpo) {
    return "Informe um nome de usuário.";
  }

  if (limpo.length < 3) {
    return "O nome de usuário deve conter pelo menos 3 caracteres.";
  }

  if (limpo.length > 30) {
    return "O nome de usuário deve conter no máximo 30 caracteres.";
  }

  if (!/^[a-zA-Z0-9._\-\sÀ-ÿ]+$/.test(limpo)) {
    return "Utilize apenas letras, números, espaços, ponto, hífen ou sublinhado.";
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

  return user.email;
}

function atualizarCabecalho() {
  if (!usuarioAtual) {
    return;
  }

  const nomeExibicao = obterNomeExibicao(perfilAtual, usuarioAtual);
  elementos.tituloUsuario.textContent = `Olá, ${nomeExibicao}`;
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

function renderizarTransacoes(transacoes) {
  const resumo = calcularResumo(transacoes);
  elementos.saldoAtual.textContent = formatarMoeda(resumo.saldo);
  elementos.totalEntradas.textContent = formatarMoeda(resumo.entradas);
  elementos.totalSaidas.textContent = formatarMoeda(resumo.saidas);

  if (!transacoes.length) {
    elementos.listaTransacoes.innerHTML = `
      <div class="transacao-vazia">
        <p>Nenhuma transação foi registrada até o momento.</p>
      </div>
    `;
    return;
  }

  const ordenadas = [...transacoes].sort((atual, proxima) => {
    if (atual.data === proxima.data) {
      return (proxima.createdAtMs || 0) - (atual.createdAtMs || 0);
    }

    return atual.data < proxima.data ? 1 : -1;
  });

  elementos.listaTransacoes.innerHTML = ordenadas
    .map((transacao) => {
      const classe = transacao.tipo === "entrada" ? "entrada" : "saida";
      const valor = transacao.tipo === "entrada"
        ? `+${formatarMoeda(transacao.valor)}`
        : `-${formatarMoeda(transacao.valor)}`;

      return `
        <article class="linha-transacao">
          <span class="pill-tipo ${classe}">${transacao.tipo === "entrada" ? "Entrada" : "Saída"}</span>
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
  const usuariosFiltrados = usuarios.filter((usuario) => usuario.email !== ADMIN_EMAIL);

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
        <p>Nenhuma ação administrativa foi registrada.</p>
      </div>
    `;
    return;
  }

  elementos.listaLogsAdmin.innerHTML = logs
    .map((log) => `
      <article class="linha-log">
        <span class="pill-log">${LOG_LABEL[log.actionType] || log.actionType}</span>
        <strong>${log.userEmail}</strong>
        <p>UID: ${log.affectedUid}</p>
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
    () => {
      exibirMensagem(elementos.mensagemApp, "Não foi possível carregar as transações.", "erro");
    }
  );
}

function iniciarEscutaUsuariosAdmin() {
  if (limpezaEscutaUsuarios) {
    limpezaEscutaUsuarios();
  }

  const consulta = query(collection(db, "users"), orderBy("email", "asc"));
  limpezaEscutaUsuarios = onSnapshot(
    consulta,
    (snapshot) => {
      const usuarios = snapshot.docs.map((item) => item.data());
      renderizarUsuariosAdmin(usuarios);
    },
    () => {
      exibirMensagem(elementos.mensagemApp, "Não foi possível carregar a lista de usuários.", "erro");
    }
  );
}

function iniciarEscutaLogsAdmin() {
  if (limpezaEscutaLogs) {
    limpezaEscutaLogs();
  }

  const consulta = query(collection(db, "admin_logs"), orderBy("createdAt", "desc"), limit(20));
  limpezaEscutaLogs = onSnapshot(
    consulta,
    (snapshot) => {
      const logs = snapshot.docs.map((item) => item.data());
      renderizarLogsAdmin(logs);
    },
    () => {
      exibirMensagem(elementos.mensagemApp, "Não foi possível carregar os logs administrativos.", "erro");
    }
  );
}

async function registrarLogAdmin(actionType, affectedUid, userEmail) {
  await addDoc(collection(db, "admin_logs"), {
    actionType,
    affectedUid,
    userEmail,
    createdAt: serverTimestamp()
  });
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
      mensagem: "Cadastro enviado com sucesso. Aguarde aprovação do administrador."
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

  limpezaEscutaStatus = onSnapshot(doc(db, "users", user.uid), async (snapshotUsuario) => {
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
          : "Seu cadastro está aguardando aprovação do administrador.";

      exibirMensagem(elementos.mensagemAuth, mensagem, dados.status === "pending" ? "info" : "erro");
      await fazerLogout();
    }
  });
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
  } catch {
    exibirMensagem(elementos.mensagemAuth, "Não foi possível validar seu acesso no momento.", "erro");
    await fazerLogout();
  }
}

function validarFormularioAuth(email, senha) {
  if (!email || !senha) {
    return "Preencha todos os campos obrigatórios.";
  }

  if (!validarEmail(email)) {
    return "Informe um email válido.";
  }

  if (senha.length < 6) {
    return "A senha deve conter no mínimo 6 caracteres.";
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
      "Cadastro enviado com sucesso. Aguarde aprovação do administrador.",
      "sucesso"
    );
  } catch (erro) {
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
    exibirMensagem(elementos.mensagemAuth, traduzirErroAuth(erro.code), "erro");
  }
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
    exibirMensagem(elementos.mensagemApp, "Transação registrada com sucesso.", "sucesso");
  } catch {
    exibirMensagem(elementos.mensagemApp, "Não foi possível registrar a transação.", "erro");
  }
}

async function excluirTransacao(id) {
  try {
    await deleteDoc(doc(db, "transactions", id));
    exibirMensagem(elementos.mensagemApp, "Transação excluída com sucesso.", "sucesso");
  } catch {
    exibirMensagem(elementos.mensagemApp, "Não foi possível excluir a transação.", "erro");
  }
}

async function aprovarUsuario(uid, email) {
  await updateDoc(doc(db, "users", uid), { status: "approved" });
  await registrarLogAdmin("approve", uid, email);
  exibirMensagem(elementos.mensagemApp, "Usuário aprovado com sucesso.", "sucesso");
}

async function rejeitarUsuario(uid, email) {
  await updateDoc(doc(db, "users", uid), { status: "rejected" });
  await registrarLogAdmin("reject", uid, email);
  exibirMensagem(elementos.mensagemApp, "Usuário rejeitado com sucesso.", "sucesso");
}

async function desativarUsuario(uid, email) {
  await updateDoc(doc(db, "users", uid), { status: "deactivated" });
  await registrarLogAdmin("deactivate", uid, email);
  exibirMensagem(elementos.mensagemApp, "Conta desativada com sucesso.", "sucesso");
}

async function reativarUsuario(uid, email) {
  await updateDoc(doc(db, "users", uid), { status: "approved" });
  await registrarLogAdmin("reactivate", uid, email);
  exibirMensagem(elementos.mensagemApp, "Conta reativada com sucesso.", "sucesso");
}

async function enviarResetSenhaPorEmail(uid, email) {
  await sendPasswordResetEmail(auth, email);
  await registrarLogAdmin("password_reset_email", uid, email);
  exibirMensagem(elementos.mensagemApp, "Email de redefinição enviado com sucesso.", "sucesso");
}

async function excluirContaUsuario(uid, email) {
  const consulta = query(collection(db, "transactions"), where("uid", "==", uid));
  const snapshot = await getDocs(consulta);
  await Promise.all(snapshot.docs.map((item) => deleteDoc(doc(db, "transactions", item.id))));
  await deleteDoc(doc(db, "users", uid));
  await registrarLogAdmin("delete", uid, email);
  exibirMensagem(
    elementos.mensagemApp,
    "Conta removida da coleção users e transações excluídas. A remoção do Firebase Authentication exige Admin SDK ou Cloud Function.",
    "info"
  );
}

async function executarAcaoAdmin(acao, uid, email) {
  if (email === ADMIN_EMAIL) {
    return;
  }

  if (acao === "approve") {
    await aprovarUsuario(uid, email);
    return;
  }

  if (acao === "reject") {
    await rejeitarUsuario(uid, email);
    return;
  }

  if (acao === "deactivate") {
    const confirmar = window.confirm("Confirma a desativação desta conta?");
    if (!confirmar) {
      return;
    }

    await desativarUsuario(uid, email);
    return;
  }

  if (acao === "reactivate") {
    await reativarUsuario(uid, email);
    return;
  }

  if (acao === "password_reset_email") {
    const confirmar = window.confirm("Deseja enviar um email para redefinição de senha deste usuário?");
    if (!confirmar) {
      return;
    }

    await enviarResetSenhaPorEmail(uid, email);
    return;
  }

  if (acao === "delete") {
    const confirmar = window.confirm("Confirma a exclusão da conta deste usuário no Firestore?");
    if (!confirmar) {
      return;
    }

    await excluirContaUsuario(uid, email);
  }
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
    exibirMensagem(elementos.mensagemPerfil, "Nome de usuário atualizado com sucesso.", "sucesso");
    exibirMensagem(elementos.mensagemApp, "Perfil atualizado com sucesso.", "sucesso");
    perfilAtual = { ...perfilAtual, username };
    atualizarCabecalho();
    window.setTimeout(() => {
      fecharModalPerfil();
    }, 500);
  } catch {
    exibirMensagem(elementos.mensagemPerfil, "Não foi possível salvar o nome de usuário.", "erro");
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
  } catch {
    exibirMensagem(elementos.mensagemApp, "Não foi possível concluir a ação administrativa.", "erro");
  }
});

definirDataPadrao();
onAuthStateChanged(auth, tratarMudancaAutenticacao);
